// The browser-only wire client (glue-code decision #38) lands here in
// bridge build 2. Until then this entry re-exports only the shared protocol.
export {
	BRIDGE_PROTOCOL_VERSION,
	type BridgeMessage,
	type PageMessage,
	type WireCommand,
	type WireMessage,
} from "./protocol";
