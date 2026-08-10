// Kernel spec §4 — installation, activation, and teardown — and §5's
// PluginApi wiring over the four primitives (§6–§9). This internal
// factory grows into `createSwitchboard` (§18) as later slices land
// storage, the capability check, and the handoff.

import { type CommandRegistry, createCommandRegistry } from "./commands";
import { type ContextStore, createContextStore } from "./context";
import { createDiagnosticsHub, type DiagnosticsChannel } from "./diagnostics";
import { DisposableStore } from "./disposable";
import { SwitchboardError } from "./errors";
import { createEventBus, type EventBus } from "./events";
import { validateManifest } from "./manifest";
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
	// §10.1: capability name → providing plugin id, from validated manifests.
	// Built before any setup runs so §9's rejection rules see plugins later
	// in the activation order (get is activation-order-insensitive). First
	// provider wins here; the §10.2 duplicate-provider error is a later slice.
	const providers = new Map<string, string>();

	const commands: CommandRegistry = createCommandRegistry(hub);
	const events: EventBus = createEventBus(hub);
	const context: ContextStore = createContextStore(hub);
	const services: ServiceRegistry = createServiceRegistry(hub, {
		providerOf: (name) => providers.get(name),
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
			for (const entry of result.manifest.provides ?? []) {
				const at = entry.indexOf("@");
				const name = at === -1 ? entry : entry.slice(0, at);
				if (!providers.has(name)) providers.set(name, id);
			}
		}

		// Phase 2 — activate in array order (§4.2: never reordered, each
		// setup awaited; the §10.3 capability check lands with §10–§12).
		for (const plugin of installed.values()) {
			const id = plugin.definition.id;
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
