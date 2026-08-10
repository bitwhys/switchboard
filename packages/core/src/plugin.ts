// Kernel spec §3 — plugin definition.

import type { CommandsApi } from "./commands";
import type { ContextApi } from "./context";
import type { Diagnostic, DiagnosticSeverity } from "./diagnostics";
import type { Disposable } from "./disposable";
import type { EventsApi } from "./events";
import type { ServicesApi } from "./services";

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
 * Kernel spec §5 — the plugin's only door into the kernel, grouped by
 * primitive plus kernel infrastructure. Still to land: `plugins`
 * (§16.2, host-surface slice) and `storage` (§13 slice).
 */
export interface PluginApi {
	commands: CommandsApi;
	events: EventsApi;
	context: ContextApi;
	services: ServicesApi;
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
