// Kernel spec §4 — installation, activation, and teardown — and §5's
// PluginApi wiring over the four primitives (§6–§9). This internal
// factory grows into `createSwitchboard` (§18) as later slices land
// storage, the capability check, and the handoff.

import satisfies from "semver/functions/satisfies.js";
import { type CommandRegistry, createCommandRegistry } from "./commands";
import { type ContextStore, createContextStore } from "./context";
import { createDiagnosticsHub, type DiagnosticsChannel } from "./diagnostics";
import { DisposableStore } from "./disposable";
import { SwitchboardError } from "./errors";
import { createEventBus, type EventBus } from "./events";
import { validateManifest } from "./manifest";
import { splitCapability } from "./names";
import type { PluginApi, PluginDefinition } from "./plugin";
import { createServiceRegistry, type ServiceRegistry } from "./services";

export interface KernelOptions {
	plugins: PluginDefinition[];
	/** Diagnostics spec §7 — default on. */
	dev?: boolean;
	/** Diagnostics spec §6.3 — console reporter switch. */
	diagnostics?: { console?: boolean };
}

export interface Kernel {
	diagnostics: DiagnosticsChannel;
	/** §18.2 — settles when activation has settled; never rejects. */
	ready: Promise<void>;
	dispose(): void;
}

type PluginStatus = "pending" | "active" | "failed";

interface InstalledPlugin {
	definition: PluginDefinition;
	status: PluginStatus;
	/** The setup failure, once status is `failed` (§9: pending gets reject with it). */
	failure?: unknown;
	disposables: DisposableStore;
}

export function createKernel(options: KernelOptions): Kernel {
	// §18.3: structurally unusable options throw before any kernel exists.
	if (
		typeof options !== "object" ||
		options === null ||
		!Array.isArray(options.plugins)
	) {
		throw new SwitchboardError({
			code: "invalid-options",
			source: "kernel",
			message: "createSwitchboard requires a `plugins` array (§18.1)",
		});
	}

	const dev = options.dev !== false;
	const hub = createDiagnosticsHub({
		dev,
		console: options.diagnostics?.console !== false,
	});
	const installed = new Map<string, InstalledPlugin>();
	// §10.1/§10.2: capability name → its one installed provider (with the
	// declared version, for §10.3's satisfies check and near-miss messages).
	// Built before any setup runs so §9's rejection rules and §10.3's check
	// see plugins later in the activation order. §10.2 keeps it single: a
	// colliding plugin is blocked at install and indexes nothing.
	const providers = new Map<string, { plugin: string; version?: string }>();

	const commands: CommandRegistry = createCommandRegistry(hub);
	const events: EventBus = createEventBus(hub);
	const context: ContextStore = createContextStore(hub);
	const services: ServiceRegistry = createServiceRegistry(hub, {
		providerOf: (name) => providers.get(name)?.plugin,
		failureOf: (pluginId) => installed.get(pluginId)?.failure,
	});

	// Deferred one microtask so consumers of the synchronously-returned
	// kernel can subscribe to diagnostics before any plugin is processed
	// (§18.1: activation proceeds from the call but is not awaited).
	const ready = (async () => {
		await Promise.resolve();

		// Phase 1 — install: validate every manifest and index capability
		// providers, so activation (phase 2) runs against the full array.
		for (const definition of options.plugins) {
			const result = validateManifest(definition);
			if (!result.ok) {
				hub.emit({
					severity: "error",
					code: result.code,
					source: "kernel",
					plugin: result.plugin,
					subject: result.subject,
					message: result.message,
				});
				continue;
			}
			const id = result.manifest.id;
			// §2.2: plugin ids are exclusive — first wins, the duplicate is blocked (§18.3).
			if (installed.has(id)) {
				hub.emit({
					severity: "error",
					code: "name-taken",
					source: "kernel",
					plugin: id,
					subject: id,
					message: `plugin id ${JSON.stringify(id)} is already installed — first wins (§2.2)`,
				});
				continue;
			}
			// §10.2: at most one installed plugin may provide a capability name.
			// A collision — with an already-installed plugin or within this
			// manifest — blocks this plugin at install: none of its provides
			// index, so they satisfy no check and reject service gets (§9).
			const provides = (result.manifest.provides ?? []).map((entry) => {
				const parts = splitCapability(entry);
				// unreachable when undefined: §3.3 validated the grammar above
				return parts ?? { name: entry };
			});
			const own = new Set<string>();
			let collision: { name: string } | undefined;
			for (const p of provides) {
				if (providers.has(p.name) || own.has(p.name)) {
					collision = p;
					break;
				}
				own.add(p.name);
			}
			if (collision) {
				const holder = providers.get(collision.name)?.plugin ?? id;
				hub.emit({
					severity: "error",
					code: "duplicate-provider",
					source: "kernel",
					plugin: id,
					subject: collision.name,
					message: `${id} provides ${JSON.stringify(collision.name)}, already provided by ${holder} — at most one installed provider (§10.2)`,
				});
				continue;
			}
			for (const w of result.warnings) {
				hub.emit({
					severity: "warning",
					code: w.code,
					source: "kernel",
					plugin: id,
					subject: w.subject,
					message: w.message,
				});
			}
			installed.set(id, {
				definition: result.manifest,
				status: "pending",
				disposables: new DisposableStore(),
			});
			for (const p of provides) {
				providers.set(p.name, { plugin: id, version: p.version });
			}
		}

		// Phase 2 — activate in array order (§4.2: never reordered, each
		// setup awaited).
		for (const plugin of installed.values()) {
			const id = plugin.definition.id;
			// §10.3: the capability check — once per plugin, before its setup,
			// against installed (not activated) plugins. Failure blocks this
			// plugin only; there is no runtime re-check after activation.
			const unsatisfied = checkRequires(id, plugin.definition.requires);
			if (unsatisfied.length > 0) {
				plugin.status = "failed";
				plugin.failure = unsatisfied[0];
				services.onPluginFailed(id, unsatisfied[0]);
				for (const error of unsatisfied) {
					hub.emit({
						severity: "error",
						code: error.code,
						source: error.source,
						plugin: error.plugin,
						subject: error.subject,
						message: error.message,
					});
				}
				continue;
			}
			try {
				await plugin.definition.setup(createPluginApi(id, plugin));
				plugin.status = "active";
			} catch (cause) {
				plugin.status = "failed";
				plugin.failure = cause;
				// §9: a failed provider rejects its pending service gets.
				services.onPluginFailed(id, cause);
				hub.emit({
					severity: "error",
					code: "setup-failed",
					source: "kernel",
					plugin: id,
					message: `plugin ${id} setup ${cause instanceof Error ? `threw: ${cause.message}` : "rejected"} (§4.2)`,
				});
			}
		}
	})();

	// §10.3: one error per unsatisfied `requires` entry, each naming the
	// requiring plugin, the required string, and the near-miss with versions
	// (single provider, §10.2, so there is at most one near-miss per name).
	function checkRequires(
		id: string,
		requires: string[] | undefined,
	): SwitchboardError[] {
		const errors: SwitchboardError[] = [];
		for (const entry of requires ?? []) {
			const parts = splitCapability(entry);
			if (!parts) continue; // §3.3 already rejected malformed entries
			const provider = providers.get(parts.name);
			let nearMiss: string | undefined;
			if (provider) {
				const range = parts.version;
				if (range === undefined) continue; // bare name: any version (§10.1)
				if (
					provider.version !== undefined &&
					satisfies(provider.version, range)
				) {
					continue;
				}
				nearMiss =
					provider.version === undefined
						? `\`${provider.plugin}\` provides \`${parts.name}\` (no version declared, range cannot be checked)`
						: `\`${provider.plugin}\` provides \`${parts.name}@${provider.version}\` (range not satisfied)`;
			}
			errors.push(
				new SwitchboardError({
					code: "capability-unsatisfied",
					source: "kernel",
					plugin: id,
					subject: entry,
					message: `\`${id}\` requires \`${entry}\`; ${
						nearMiss
							? `${nearMiss}; no other providers installed`
							: "no provider installed"
					} (§10.3)`,
				}),
			);
		}
		return errors;
	}

	function createPluginApi(id: string, plugin: InstalledPlugin): PluginApi {
		// §4.3: every registration Disposable the kernel hands out is also
		// tracked, so deactivation cleans up everything the kernel can see.
		const track = <T extends { dispose(): void }>(d: T): T =>
			plugin.disposables.track(d);
		return {
			commands: {
				register: (command) => track(commands.register(id, command)),
				// §6: invocations through the plugin door carry source 'plugin'.
				execute: (commandId, input) =>
					commands.execute("plugin", id, commandId, input),
			},
			events: {
				emit: (name, payload) => events.emit(id, name, payload),
				on: (name, cb) => track(events.on(id, name, cb)),
			},
			context: {
				set: (key, value) => context.set(id, key, value),
				get: (key) => context.get(id, key),
				delete: (key) => context.delete(id, key),
				observe: (key, cb) => track(context.observe(id, key, cb)),
			},
			services: {
				register: (name, service) =>
					track(services.register(id, name, service)),
				get: (name) => services.get(id, name),
				tryGet: (name) => services.tryGet(id, name),
			},
			diagnostics: {
				// Diagnostics §6.2: emission half only — never throws; `source`
				// is stamped with the calling plugin's id, unconditionally (§4.1).
				emit(entry) {
					hub.emit({
						severity: entry.severity,
						code: entry.code,
						source: id,
						plugin: entry.plugin,
						subject: entry.subject,
						message: entry.message,
					});
				},
				subscribe: (cb) => track(hub.subscribe(cb)),
			},
			// §4.3: teardown for effects the kernel cannot see.
			onDispose(fn) {
				plugin.disposables.track({ dispose: fn });
			},
		};
	}

	return {
		diagnostics: { subscribe: (cb) => hub.subscribe(cb) },
		ready,
		// §4.3: deactivation disposes everything the kernel can see, in
		// reverse activation order. Context keys are NOT auto-deleted (§8.4).
		dispose() {
			for (const plugin of [...installed.values()].reverse()) {
				plugin.disposables.dispose();
			}
			installed.clear();
		},
	};
}
