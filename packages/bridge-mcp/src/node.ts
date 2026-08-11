// @switchboard-dev/bridge-mcp/node — the bridge component itself, run in the
// dev-server process (bridge spec §1). Adapters construct a Bridge, ferry
// protocol messages between it and their page channel, and mount (or start) the
// MCP door.

export {
	Bridge,
	type BridgeOptions,
	type ContextReadOutcome,
	createBridge,
	type InvokeOutcome,
	type PageConnection,
	type RegistryListener,
	type TailEntry,
} from "./node/core";
export {
	type DiagnosticWriter,
	stderrDiagnosticWriter,
} from "./node/diagnostics";
export {
	type BridgeServer,
	type BridgeServerOptions,
	createMcpHandler,
	DEFAULT_BRIDGE_PORT,
	type McpHandler,
	type McpHandlerOptions,
	startBridgeServer,
} from "./node/http";
export { createMcpSession } from "./node/mcp";
export {
	type AnnouncedCommand,
	BRIDGE_PROTOCOL_VERSION,
	type BridgeMessage,
	type PageMessage,
	type ProtocolMessage,
} from "./protocol";
