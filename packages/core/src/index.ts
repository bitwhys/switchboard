// @switchboard-dev/core — the Switchboard kernel.

export type {
	CommandDefinition,
	CommandRecord,
	CommandsApi,
	ContextView,
	Invocation,
	StandardSchemaValidate,
} from "./commands";
export type { ContextApi } from "./context";
export type {
	Diagnostic,
	DiagnosticSeverity,
	DiagnosticsChannel,
} from "./diagnostics";
export type { Disposable } from "./disposable";
export type { SwitchboardErrorInit, ValidationIssue } from "./errors";
export { SwitchboardError } from "./errors";
export type { EmitMeta, EventsApi } from "./events";
export type { KernelHandoff } from "./handoff";
export type { Switchboard, SwitchboardOptions } from "./kernel";
export type {
	DiagnosticsApi,
	PluginApi,
	PluginDefinition,
	PluginRecord,
	PluginStatus,
	PluginsApi,
} from "./plugin";
export { definePlugin } from "./plugin";
export type { ServicesApi } from "./services";
export type { StorageArea, StorageEngine } from "./storage";
export { localStorageEngine, memoryEngine } from "./storage";
export { createSwitchboard } from "./switchboard";
