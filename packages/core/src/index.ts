// @switchboard-dev/core — the Switchboard kernel.
// Public surface of the §2–§9 build slices; the construction surface
// (`createSwitchboard`, kernel spec §18) lands with the host-surface slice.

export type {
	CommandDefinition,
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
export type { DiagnosticsApi, PluginApi, PluginDefinition } from "./plugin";
export { definePlugin } from "./plugin";
export type { ServicesApi } from "./services";
export type { StorageArea, StorageEngine } from "./storage";
export { localStorageEngine, memoryEngine } from "./storage";
