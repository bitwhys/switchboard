// @switchboard-dev/bridge-mcp — the page ⇄ agent bridge.
//
// The root entry carries only the environment-agnostic Switchboard protocol (bridge
// spec §4–§9): both ends import their shared vocabulary from here, so
// BRIDGE_PROTOCOL_VERSION is defined exactly once. The node-side bridge
// lives at `@switchboard-dev/bridge-mcp/node`; the browser page client will
// land at its own subpath (bridge build 2).

export {
	type AnnouncedCommand,
	BRIDGE_PROTOCOL_VERSION,
	type BridgeMessage,
	type Cancel,
	type ContextRead,
	type ContextValue,
	type EventPush,
	type Focus,
	type Hello,
	type HelloOk,
	type HelloReject,
	type Invoke,
	type InvokeResult,
	type PageMessage,
	type ProtocolMessage,
	type Snapshot,
} from "./protocol";
