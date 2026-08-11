// The Switchboard protocol — the page-facing message envelope (bridge spec
// §4–§9, §13). Shared by the node-side bridge and the browser page client, so
// BRIDGE_PROTOCOL_VERSION is defined exactly once (glue-code decision #38).
// This module must stay environment-agnostic: no node imports.

/** Bridge spec §2 — plain integer, bumped only on breaking protocol changes. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** Bridge spec §6.1 — one announced registry entry, tagged with its owner. */
export interface AnnouncedCommand {
	/** Command id, verbatim (kernel spec §2, §6.1). */
	id: string;
	title: string;
	description?: string;
	/** Plain JSON Schema, verbatim (kernel spec §6.2). */
	inputSchema?: object;
	outputSchema?: object;
	/** MCP ToolAnnotations, verbatim (kernel spec §6.4). */
	annotations?: object;
	/** Owning plugin — the attribution carrier (§3.4). */
	pluginId: string;
}

// ── page → bridge ────────────────────────────────────────────────────────

/** §5.1 — first message on every new connection; no resumption. */
export interface Hello {
	type: "hello";
	/** The page bundle's BRIDGE_PROTOCOL_VERSION. */
	protocolVersion: number;
	/** Semver; diagnostics only, never gates (§2). */
	kernelApiVersion: string;
	/** RESERVED — carried but ignored in v1 (§15.4). */
	auth?: unknown;
}

/** §6.1 — always the COMPLETE current agent-listable surface, never a diff. */
export interface Snapshot {
	type: "snapshot";
	commands: AnnouncedCommand[];
}

/** §7.1 — answers an `invoke`, echoing its id. */
export interface InvokeResult {
	type: "result";
	id: string;
	ok: boolean;
	/** Present iff ok — the command's return value. */
	value?: unknown;
	/** Present iff !ok — wrapped with the command id. */
	error?: { message: string };
}

/** §8.1 — answers a `context-read`, echoing its id. */
export interface ContextValue {
	type: "context-value";
	id: string;
	present: boolean;
	/** Present iff `present` — the latest agent-visible value. */
	value?: unknown;
	/** The writer, when a value is present (§3.4). */
	pluginId?: string;
	/** When `present` is false (§8.2). */
	reason?: "unset" | "not-granted";
}

/** §9.1 — one-way push per granted emission; no acknowledgment. */
export interface EventPush {
	type: "event";
	name: string;
	payload?: unknown;
	/** The emitter (§3.4). */
	pluginId: string;
	/** Page-side emit time, ms since epoch. */
	timestamp: number;
}

/** §13.2 — lightweight notification when the page gains focus. */
export interface Focus {
	type: "focus";
}

export type PageMessage =
	| Hello
	| Snapshot
	| InvokeResult
	| ContextValue
	| EventPush
	| Focus;

// ── bridge → page ────────────────────────────────────────────────────────

/** §5.2 — handshake acceptance on exact protocol-version match. */
export interface HelloOk {
	type: "hello-ok";
	protocolVersion: number;
	/** Bridge side; diagnostics only. */
	kernelApiVersion: string;
	/** Bridge-minted, stable for this connection (§13.3). */
	tabId: string;
}

/** §5.3 — structured rejection on mismatch; the connection then closes. */
export interface HelloReject {
	type: "hello-reject";
	pageProtocolVersion: number;
	bridgeProtocolVersion: number;
	pageKernelApiVersion: string;
	bridgeKernelApiVersion: string;
	/** Plain language, actionable. */
	reason: string;
}

/** §7.1 — dispatch request; id minted by the bridge. */
export interface Invoke {
	type: "invoke";
	id: string;
	/** Command id. */
	command: string;
	input?: object;
}

/** §7.3 — cooperative, best-effort cancellation of an in-flight invoke. */
export interface Cancel {
	type: "cancel";
	id: string;
}

/** §8.1 — a live round-trip read; the bridge keeps no mirror and no cache. */
export interface ContextRead {
	type: "context-read";
	id: string;
	key: string;
}

export type BridgeMessage =
	| HelloOk
	| HelloReject
	| Invoke
	| Cancel
	| ContextRead;

export type ProtocolMessage = PageMessage | BridgeMessage;
