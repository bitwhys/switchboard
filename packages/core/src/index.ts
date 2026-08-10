// @switchboard-dev/core — the Switchboard kernel.
// Public surface of the §2–§4 build slice; the construction surface
// (`createSwitchboard`, kernel spec §18) lands with a later slice.

export type {
	Diagnostic,
	DiagnosticSeverity,
	DiagnosticsChannel,
} from "./diagnostics";
export type { Disposable } from "./disposable";
export type { SwitchboardErrorInit } from "./errors";
export { SwitchboardError } from "./errors";
export type { DiagnosticsApi, PluginApi, PluginDefinition } from "./plugin";
export { definePlugin } from "./plugin";
