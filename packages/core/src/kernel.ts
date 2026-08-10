// Kernel spec §4 — installation, activation, and teardown. This internal
// factory grows into `createSwitchboard` (§18) as later slices land the
// primitives, storage, and the handoff.

import { createDiagnosticsHub, type DiagnosticsChannel } from "./diagnostics";
import { DisposableStore } from "./disposable";
import { SwitchboardError } from "./errors";
import { validateManifest } from "./manifest";
import type { PluginApi, PluginDefinition } from "./plugin";

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

	// Deferred one microtask so consumers of the synchronously-returned
	// kernel can subscribe to diagnostics before any plugin is processed
	// (§18.1: activation proceeds from the call but is not awaited).
	const ready = (async () => {
		await Promise.resolve();
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
			const plugin: InstalledPlugin = {
				definition: result.manifest,
				status: "pending",
				disposables: new DisposableStore(),
			};
			installed.set(id, plugin);
			// §4.2: activation — run setup, awaiting it in array order. The v1
			// hint vocabulary is exactly `eager`, so every installed plugin
			// activates now; unknown hints were warned and behaviorally
			// ignored (§4.1). (The §10.3 capability check lands with §10–§12.)
			try {
				await plugin.definition.setup(createPluginApi(id, plugin));
				plugin.status = "active";
			} catch (cause) {
				plugin.status = "failed";
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
		return {
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
				subscribe: (cb) => plugin.disposables.track(hub.subscribe(cb)),
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
		// reverse activation order.
		dispose() {
			for (const plugin of [...installed.values()].reverse()) {
				plugin.disposables.dispose();
			}
			installed.clear();
		},
	};
}
