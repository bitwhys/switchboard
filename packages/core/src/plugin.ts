// Kernel spec §3 — plugin definition.

import type { CommandsApi } from "./commands";
import type { ContextApi } from "./context";
import type { Diagnostic, DiagnosticSeverity } from "./diagnostics";
import type { Disposable } from "./disposable";
import type { EventsApi } from "./events";
import type { ServicesApi } from "./services";
import type { StorageArea } from "./storage";

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

/** Kernel spec §16.2 — a plugin's lifecycle state as the list reports it. */
export type PluginStatus = "pending" | "active" | "failed";

/**
 * Kernel spec §16.2 — one installed plugin: its manifest data verbatim
 * (everything except `setup`, unknown fields included) plus the
 * kernel-added `status`.
 */
export interface PluginRecord {
	id: string;
	name: string;
	version: string;
	description?: string;
	package?: string;
	permissions?: string[];
	activation?: string[];
	provides?: string[];
	requires?: string[];
	status: PluginStatus;
}

/** Kernel spec §16.2 — the read-only installed-plugin list, on both doors (§16.3). */
export interface PluginsApi {
	list(): PluginRecord[];
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
 * primitive plus kernel infrastructure.
 */
export interface PluginApi {
	commands: CommandsApi;
	events: EventsApi;
	context: ContextApi;
	services: ServicesApi;
	/** §16.2 — read-only installed-plugin list. */
	plugins: PluginsApi;
	/** §13 — always present; gated by `storage:use` (§13.5). */
	storage: StorageArea;
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
