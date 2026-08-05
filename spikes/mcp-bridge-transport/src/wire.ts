/**
 * Switchboard wire protocol — spike edition.
 *
 * Decision 5 (#11): own minimal envelope, NOT JSON-RPC, NOT MCP. Typed JSON
 * messages discriminated by `type`; request/response correlated by echoed `id`.
 * Plain objects so any adapter channel can carry them (here: Vite's HMR WS,
 * as `switchboard:msg` custom events).
 */

/** Decision 6: plain integer, bumped only on breaking wire changes. */
export const BRIDGE_PROTOCOL_VERSION = 1

/** Travels alongside in the handshake — diagnostics only, never gates. */
export const KERNEL_API_VERSION = '0.1.0-spike'

export interface CommandAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** One announced registry entry. Decision 7: tagged with its owning plugin id. */
export interface WireCommand {
  /** MCP-legal id: [A-Za-z0-9_.-], <=128 chars (kernel decision #5). */
  id: string
  pluginId: string
  description?: string
  /** Plain JSON Schema, draft 2020-12 (schema decision #3). */
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: CommandAnnotations
}

/** Page → bridge */
export type PageToBridge =
  | {
      type: 'hello'
      bridgeProtocolVersion: number
      kernelApiVersion: string
      /** Decision 6/13: reserved, ignored in v1. */
      auth?: unknown
    }
  /** Decision 7: always the complete current registry, never a delta. */
  | { type: 'snapshot'; commands: WireCommand[]; contextKeys: string[] }
  | { type: 'invoke-result'; id: string; ok: true; result: unknown }
  | { type: 'invoke-result'; id: string; ok: false; error: string }
  | { type: 'context-value'; id: string; ok: true; value: unknown }
  | { type: 'context-value'; id: string; ok: false; error: string }
  /** Push-only: feeds the bridge-side tail buffer (decision 1). */
  | { type: 'event'; name: string; pluginId: string; payload: unknown }
  /** Decision 11: lightweight focus notification for the active-tab model. */
  | { type: 'focus' }

/** Bridge → page */
export type BridgeToPage =
  | { type: 'hello-ok'; tabId: string; bridgeProtocolVersion: number }
  | {
      type: 'hello-reject'
      reason: string
      server: { bridgeProtocolVersion: number; kernelApiVersion: string }
      page: { bridgeProtocolVersion: number; kernelApiVersion: string }
    }
  | { type: 'invoke'; id: string; command: string; input: unknown }
  /** Decision 9: cooperative cancel referencing the invocation id. */
  | { type: 'cancel'; id: string }
  | { type: 'context-read'; id: string; key: string }

export type WireMessage = PageToBridge | BridgeToPage

/** The single custom-event name the Vite adapter rides on the HMR channel. */
export const WIRE_EVENT = 'switchboard:msg'
