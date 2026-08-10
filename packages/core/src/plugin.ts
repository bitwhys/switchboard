// Kernel spec §3 — plugin definition.

import type { Diagnostic, DiagnosticSeverity } from "./diagnostics";
import type { Disposable } from "./disposable";

/** Kernel spec §3.1 — the single definition object: static manifest + entry point. */
export interface PluginDefinition {
	id: string;
	name: string;
	version: string;
	description?: string;
	package?: string;
	permissions?: string[];
	activation?: string[];
	provides?: string[];
	requires?: string[];
	setup(api: PluginApi): void | Promise<void>;
}

/** Diagnostics spec §6.2 — emission plus subscription, source stamped by the kernel. */
export interface DiagnosticsApi {
	emit(d: {
		severity: DiagnosticSeverity;
		code: string;
		plugin?: string;
		subject?: string;
		message: string;
	}): void;
	subscribe(cb: (d: Diagnostic) => void): Disposable;
}

/**
 * Kernel spec §5 — the plugin's only door into the kernel. This slice
 * carries kernel infrastructure only; the four primitive APIs land with
 * their own build slices (§6–§9) and `storage` with §13.
 */
export interface PluginApi {
	diagnostics: DiagnosticsApi;
	onDispose(fn: () => void): void;
}

/**
 * §3.1: an authoring affordance for type inference. Validation is the
 * kernel's job at install (§3.3); `definePlugin` never validates.
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
	return definition;
}
