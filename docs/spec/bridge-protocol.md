# Switchboard Bridge Protocol Specification

**Version: `BRIDGE_PROTOCOL_VERSION: 1`.** The bridge protocol version is a plain integer, bumped only on breaking protocol changes (§2, §16). The kernel API version (semver, [kernel spec §15](./kernel-api.md#15-versioning-and-forward-compatibility)) travels alongside on the page path for diagnostics only and never gates anything.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119.

TypeScript signatures and typed-JSON shape blocks in this document are **binding**. Prose qualifies them; it does not override them.

This document is the one place that defines two cross-cutting concerns: bridge-grant mechanics (§3), covering existence-at-the-bridge, all-or-nothing per family, and act-based attribution; and the enforcement point of the plain-JSON rule (§12). The permission *strings* and the plain-JSON *definition* live in the kernel spec ([§12](./kernel-api.md#12-permissions) and [§14](./kernel-api.md#14-the-plain-json-rule)); this document cites them and MUST NOT be read as redefining them. The words **loud**, **named error**, and **dev-mode** are defined in [`diagnostics.md`](./diagnostics.md). Related documents: [`kernel-api.md`](./kernel-api.md), [`toolbar-contract.md`](./toolbar-contract.md), [`dom-inspector-contract.md`](./dom-inspector-contract.md).

*Background (not binding): the resolution of ticket #11 (fourteen locked decisions, absorbing #15), the transport-spike validation and implementation findings of #9 ([`spikes/mcp-bridge-transport/FINDINGS.md`](../../spikes/mcp-bridge-transport/FINDINGS.md)), the transport research of #2 ([`docs/research/mcp-live-page-transport.md`](../research/mcp-live-page-transport.md)), and the adapter-hosting research of #17 ([`docs/research/adapter-next-hosting.md`](../research/adapter-next-hosting.md)).*

---

## 1. Scope and topology

The **bridge** is the translation layer between the page kernel and out-of-page agents. It has two paths speaking two different languages:

```
agent (Claude Code / Cursor / …)
   │  MCP over Streamable HTTP  —  http://localhost:<port>/<mcp-path>   (§10)
   ▼
bridge (`bridge-mcp`, in the dev-server process; one MCP server instance
   │    per agent session, all projecting ONE canonical registry)
   │  Switchboard protocol (this document, §4–§9) over the adapter's
   │  duplex channel (Vite: HMR WebSocket; Next: bridge-port WebSocket)
   ▼
page kernel (Commands / Events / Context — kernel spec §6–§8)
```

- The agent-facing edge speaks MCP and nothing else. MCP-era compatibility (the 2025-11-25 ↔ 2026-07-28 protocol shift, sessions, notification delivery) is the MCP SDK's job; nothing in this protocol depends on any MCP revision, and `BRIDGE_PROTOCOL_VERSION` is fully independent of MCP protocol versions.
- The page-facing edge speaks the Switchboard protocol defined here — Switchboard's own minimal envelope of typed JSON messages. It is deliberately not MCP and not JSON-RPC: keeping the page leg unmistakably not-MCP protects the two-language design from erosion and insulates the page from MCP's transport churn.
- **The Switchboard protocol does not care which channel carries it.** Messages are plain JSON objects; an adapter MAY carry them over any channel that provides ordered, reliable, bidirectional, message-oriented delivery (a WebSocket, Vite's HMR channel, an in-process pair). The bridge core MUST NOT assume any particular channel; channel security obligations are §15.3.
- v1 is a development tool: one dev server, loopback-bound, trusted plugin code. Nothing here is a security boundary against a malicious local process (§15); the production model arrives through the reserved `auth` field (§15.4) without a protocol version bump.

*Consolidates: #11 (decisions 5, 13), #2, #17.*

## 2. Versioning: the handshake gate

`BRIDGE_PROTOCOL_VERSION` is a plain integer. It is the sole compatibility gate on the page path: the handshake (§5) succeeds on exact match and otherwise fails with a structured rejection. There is no range negotiation: page bundle and bridge ship from the same install, so the only real-world mismatch is a stale tab, and the remedy is always "reload this tab."

The version is bumped only on breaking protocol changes. Additive changes (new message types, new optional fields) do not bump it; receivers tolerate unknowns (§4.3, §16).

`KERNEL_API_VERSION` (the `core` package's semver) travels in the handshake for diagnostics only. Both sides MUST surface it in diagnostics (§5, §11.1) and MUST NOT gate on it.

*Consolidates: #11 (decision 6), #16.*

## 3. Bridge grants: mechanics

This section is the one place that defines what the `bridge:*` permission family *does*. All three strings, their enforced status, and the grammar are defined once in [kernel spec §12](./kernel-api.md#12-permissions).

### 3.1 Default-closed existence

Without the relevant grant, a plugin's registrations do not exist at the bridge: not announced, not listed, not dispatchable, not forwarded. There is no partial visibility and no read-only tier.

- `bridge:commands` — the plugin's commands may appear as MCP tools and be invoked.
- `bridge:events` — the plugin's emissions may be forwarded to the bridge (§9).
- `bridge:context` — the plugin's context writes may be observed by agents (§8).

### 3.2 All-or-nothing per family

Each grant covers every registration of its primitive family for that plugin. There is no per-registration opt-out in v1; `bridged: false` is a reserved future additive ([kernel spec §15](./kernel-api.md#15-versioning-and-forward-compatibility)).

### 3.3 Permission = existence, `when` = listing

The two gates compose but never substitute for each other:

> A command appears in the agent tool list iff its owning plugin holds `bridge:commands` and its `when` predicate (if any) currently evaluates true ([kernel spec §11](./kernel-api.md#11-visibility-predicates-when)).

Neither gate is a security boundary; `when` is presentation ([kernel spec §11.2](./kernel-api.md#112-gates-listing-never-dispatch)), and grants gate trusted code's *exposure*, not its capability.

### 3.4 Act-based attribution

Attribution is by act, never by name ownership: the bridge forwards what a granted plugin *registered* (commands), *emitted* (events), or *wrote* (context values). Because event names and context keys are open channels ([kernel spec §2.2](./kernel-api.md#22-name-kinds)), the same name may carry granted and ungranted acts; each act is judged by its actor. Every item crossing the bridge is tagged with the acting plugin's id (§6.2, §8.2, §9.1, §10.3).

### 3.5 Enforcement point: the page

The kernel holds the manifests; the dev server does not. Grant filtering therefore happens page-side: the page MUST announce, forward, and answer only granted material (§6.2, §8.2, §9.1). The bridge trusts the page's filtering — consistent with v1's trusted-code model ([kernel spec §1](./kernel-api.md#1-scope)).

*Consolidates: #11 (decision 7), kernel spec §12 delegation.*

## 4. The message envelope

### 4.1 Messages

Every message is a single JSON object with a `type` discriminator. Requests carry an `id` minted by the requester; the response echoes it. Invocation ids and read ids MUST be unique per connection for the connection's lifetime.

```ts
type ProtocolMessage = PageMessage | BridgeMessage

// page → bridge
type PageMessage = Hello | Snapshot | InvokeResult | ContextValue | EventPush | Focus

// bridge → page
type BridgeMessage = HelloOk | HelloReject | Invoke | Cancel | ContextRead
```

The full shapes are given in the sections that define their semantics: handshake (§5), snapshot (§6), invoke/result/cancel (§7), context read (§8), event push and focus (§9, §13).

### 4.2 Channel requirements

The carrying channel MUST deliver messages in order, reliably, in both directions, and MUST signal disconnection to both ends. Everything above that (reconnect/backoff, channel establishment) is [adapter-contract](./adapter-contract.md#3-the-page-channel) business, not the Switchboard protocol's (§14.3).

### 4.3 Tolerating unknown input

The kernel's uniform rule ([kernel spec §15](./kernel-api.md#15-versioning-and-forward-compatibility)) applies to messages:

- **Unknown message types and unknown fields MUST be tolerated**: ignored (fields: preserved where echoed), with a [dev-mode diagnostic](./diagnostics.md#22-dev-mode-warnings). This is what makes additive evolution possible without a version bump (§16).
- **Malformed messages** (no `type`, unparseable JSON, a shape violating this spec) MUST produce a [loud](./diagnostics.md#21-loud-errors) diagnostic; the receiver MAY close the connection.

*Consolidates: #11 (decisions 5, 8).*

## 5. Handshake

### 5.1 Hello

The page MUST send `hello` as its first message on every new connection — including every reconnection (§14.3); there is no resumption.

```ts
interface Hello {
  type: 'hello'
  protocolVersion: number     // the page bundle's BRIDGE_PROTOCOL_VERSION
  kernelApiVersion: string    // semver; diagnostics only (§2)
  auth?: unknown              // RESERVED — carried but ignored in v1 (§15.4)
}
```

The page MUST NOT send any other message before receiving `hello-ok`; the bridge MUST NOT send `invoke` or `context-read` on a connection that has not completed the handshake.

### 5.2 Acceptance

On exact protocol-version match the bridge answers:

```ts
interface HelloOk {
  type: 'hello-ok'
  protocolVersion: number
  kernelApiVersion: string    // bridge side; diagnostics only
  tabId: string               // bridge-minted, stable for this connection (§13.3)
}
```

### 5.3 Rejection

On mismatch the bridge answers with a structured rejection and then closes the connection:

```ts
interface HelloReject {
  type: 'hello-reject'
  pageProtocolVersion: number
  bridgeProtocolVersion: number
  pageKernelApiVersion: string
  bridgeKernelApiVersion: string
  reason: string              // plain language, actionable
}
```

Both sides MUST surface the rejection: the page SHOULD render "Switchboard was updated — reload this tab" (or the `reason` text), and the bridge MUST record the most recent rejection and report it to agents via `switchboard.status` (§11.1). A rejected page is not connected; the page-absent rules (§14) apply.

*Consolidates: #11 (decision 6); validated by #9.*

## 6. Registry sync: snapshots

### 6.1 Snapshots, not deltas

Registry sync uses **full snapshots**: the page always sends its complete current agent-listable command surface. There are no delta messages. The protocol stays dumb; drift is impossible by construction; reconnect resync is the same message as everything else.

```ts
interface Snapshot {
  type: 'snapshot'
  commands: AnnouncedCommand[]     // the COMPLETE current surface — not a diff
}

interface AnnouncedCommand {
  id: string                  // command id, verbatim (kernel spec §2, §6.1)
  title: string
  description?: string
  inputSchema?: object        // plain JSON Schema, verbatim (kernel spec §6.2)
  outputSchema?: object       // plain JSON Schema, verbatim
  annotations?: object        // MCP ToolAnnotations, verbatim (kernel spec §6.4)
  pluginId: string            // owning plugin — attribution carrier (§3.4)
}
```

The page MUST send a snapshot immediately after `hello-ok`, and after any change to the surface: plugin activation or disposal, command registration or disposal, or a `when` flip. Snapshots MUST be debounced so that a burst of changes yields one message. A debounce of tens of milliseconds is RECOMMENDED.

### 6.2 What the page announces

The snapshot contains exactly the commands that are currently agent-listable: owning plugin holds `bridge:commands` and `when` evaluates true (§3.3). Both filters are computed page-side (§3.5). Schemas and annotations pass through verbatim — never rewritten, never summarized.

### 6.3 What the bridge does with it

The bridge maintains one **canonical registry** per connected tab (§13.2) and diffs each incoming snapshot against it, applying only real deltas to the agent-facing surface. An identical snapshot, which is the normal page-reload case, produces zero agent-visible change. Applied deltas propagate as one batched `tools/list_changed` per agent session per debounced registry change, never one per command (§10.1).

*Consolidates: #11 (decision 7); validated by #9 (zero reload churn, no notification storms).*

## 7. Invocation lifecycle

### 7.1 Invoke and result

```ts
interface Invoke {
  type: 'invoke'
  id: string                  // invocation id, minted by the bridge
  command: string             // command id
  input?: object
}

interface InvokeResult {
  type: 'result'
  id: string                  // echoes the invocation id
  ok: boolean
  value?: unknown             // present iff ok — the command's return value
  error?: { message: string } // present iff !ok — wrapped with the command id
}
```

The page dispatches through the kernel with `source: 'agent'` and a fresh `AbortSignal` ([kernel spec §6](./kernel-api.md#6-commands)). A handler throw, a `validate` rejection, or an unknown/unavailable command id all answer as `ok: false` with an actionable message — the connection never goes silent on a live connection.

### 7.2 The message-loop rule

**The page MUST NOT block the channel listener on command execution.** Invocation dispatch runs detached (fire-and-forget from the listener's perspective); the message listener itself returns synchronously. A listener that `await`s a running handler stalls the entire message loop — including the `cancel` that could have stopped that very handler.

*This rule exists because the failure is real: the spike observed a cancel delivered only after a 30-second command completed, purely because dispatch was awaited inline (#9, finding 1).*

### 7.3 Cancellation

```ts
interface Cancel { type: 'cancel'; id: string }
```

Agent-side cancellation, bridge timeout (§7.4), and agent disconnect mid-call each fire the cancel path: the bridge sends `cancel` with the invocation id, and the page MUST fire that invocation's `AbortSignal`. Cancellation is cooperative and best-effort — a handler that ignores its signal runs to completion. After sending `cancel`, the bridge MUST tolerate either a terminal `result` (discarded) or silence for that id.

### 7.4 Bridge timeout

The bridge MUST bound every invocation with a timeout — default 60 seconds, configurable where the application developer configures the adapter ([adapter contract §5](./adapter-contract.md#5-timeouts)). Expiry fires the cancel path and answers the agent with an error naming the command and the limit. There is no per-command override in v1 (additive later, §16).

### 7.5 Disconnect mid-invoke

If the page's channel drops while invocations are in flight, every one of them MUST fail immediately with: *page disconnected during invocation; outcome unknown.* The bridge MUST NOT wait out the grace period (§14.2) to answer — the outcome is already unknowable.

*Consolidates: #11 (decisions 9, 10); #9 (finding 1).*

## 8. Context reads

### 8.1 Live round-trips

A context read is a live round-trip to the page — the bridge keeps no mirror and no cache, so there is no staleness story: an answer is always current as of the read.

```ts
interface ContextRead { type: 'context-read'; id: string; key: string }

interface ContextValue {
  type: 'context-value'
  id: string                  // echoes the read id
  present: boolean
  value?: unknown             // present iff present — the latest agent-visible value
  pluginId?: string           // the writer, when a value is present (§3.4)
  reason?: 'unset' | 'not-granted'   // when present is false
}
```

### 8.2 Grant semantics

Attribution is by act (§3.4): the page answers with the latest value iff that value was written by a plugin holding `bridge:context`. Otherwise it answers `present: false` with a reason: `'unset'` when there is no value at all, or `'not-granted'` when a value exists but its writer holds no grant. That lets the built-in read tool (§11.2) report something actionable rather than a bare miss.

*Consolidates: #11 (decisions 1, 7, 8); validated by #9 (live counter read).*

## 9. Events and the tail buffer

### 9.1 Event push

The page pushes an `event` message for each emission by a plugin holding `bridge:events` — and only those (§3.5). Push is one-way; there is no acknowledgment.

```ts
interface EventPush {
  type: 'event'
  name: string
  payload?: unknown
  pluginId: string            // the emitter (§3.4)
  timestamp: number           // page-side emit time, ms since epoch
}
```

### 9.2 The tail buffer

The bridge keeps a bounded ring buffer of forwarded events, the **tail buffer**, served to agents by `switchboard.events.tail` (§11.3). A default capacity of 100 entries is RECOMMENDED; the capacity MAY be configurable. Each entry records the pushed fields plus the originating `tabId` (§13.2) and a bridge-assigned monotonic sequence number, so agents can poll incrementally.

The buffer is a recording kept by the bridge as a subscriber — kernel Events remain strictly ephemeral, never replayed, never buffered *in the kernel* ([kernel spec §7](./kernel-api.md#7-events)). The buffer survives page reloads and disconnections (§11.3) and dies with the dev server (§14.4): it is in-memory, and that is acceptable for a dev tool.

*Consolidates: #11 (decision 1); validated by #9 (buffer survives reload, 100-event cap enforced).*

## 10. The agent edge

### 10.1 Transport and sessions

- The MCP endpoint speaks Streamable HTTP, mounted where the adapter dictates (Vite: a dev-server middleware path; Next: the instrumentation-started bridge port — see the adapter research). It runs stateful under the 2025-era MCP protocol so change notifications have a channel; era compatibility beyond that is the MCP SDK's job (§2).
- The bridge holds one MCP server instance per agent session, all projecting the one canonical agent-facing registry (the active tab's surface, §13.2). Registry changes fan out as one batched `list_changed` per session (§6.3).
- `tools/list` MUST be rebuilt from the canonical registry on every call, and page-declared schemas MUST be returned verbatim. Change notifications are lossy cache-invalidation hints, never required: a client that ignores every notification and re-lists still sees the truth. *(Note: the spike found the MCP TS SDK's low-level `Server` (not `McpServer`) is the natural fit here: verbatim JSON Schema pass-through, list-on-demand, one `sendToolListChanged()` per change; #9, finding 3.)*
- **Idle sessions MUST be reaped.** MCP clients are not required to `DELETE` their session; without server-side GC, abandoned sessions (and their registry listeners) accumulate without bound (#9, finding 2). Explicit `DELETE` MUST also be honored with full cleanup.

### 10.2 Primitive exposure

| Primitive | Agent-edge exposure |
|---|---|
| Command | an MCP **tool** per listed command; ids pass **verbatim** as tool names — the name grammar ([kernel spec §2.1](./kernel-api.md#21-the-name-grammar)) is MCP-legal by construction, and the bridge MUST NOT sanitize |
| Context | **tools-only in v1**: `switchboard.context.read` (§11.2). The Context ↔ MCP-resources mapping is a documented **future additive** channel (§16), not built — resource-subscription client support is too thin |
| Event | the tail buffer (§9.2) served by `switchboard.events.tail` (§11.3) — a poll model, no push to agents |
| Service | **never crosses the bridge**, by definition ([kernel spec §9](./kernel-api.md#9-services)) |

### 10.3 Attribution and annotations

- Every page-derived tool MUST carry its owning plugin id in tool metadata, key `_meta["switchboard/pluginId"]` — the agent-visible face of act-based attribution (§3.4).
- Annotations pass through verbatim ([kernel spec §6.4](./kernel-api.md#64-annotations)); they are untrusted hints on both sides of the bridge. When a command declares no `openWorldHint`, the bridge MUST supply `openWorldHint: false` — Switchboard commands are closed-world.

### 10.4 `outputSchema` enforcement

Declaring `outputSchema` is a promise ([kernel spec §6.2](./kernel-api.md#62-schemas)); the bridge edge is its enforcement point. Before answering the agent, the bridge MUST validate the command's result against the declared schema; a nonconforming result becomes a clear `isError` result naming the command. The JSON Schema validator dependency lives in `bridge-mcp` — the kernel stays schema-dep-free.

### 10.5 Error model

Two tiers, matching MCP:

- **Tool results with `isError: true`** for everything a working agent can encounter: handler throws, input `validate` failures, no page connected, unknown or no-longer-listed command, bridge timeout (§7.4), disconnect mid-invoke (§7.5), `outputSchema` violations (§10.4), plain-JSON violations (§12). Error text MUST be actionable — name the command and the remedy (e.g. *"no page connected — open http://localhost:5173"*).
- **Protocol-level errors** only for malformed MCP requests.

An agent MUST NOT be able to distinguish "temporarily gone" from "never existed" via error *class* — both are `isError` with honest text, never a protocol-level "unknown tool" (§14.2).

*Consolidates: #11 (decisions 1–4); #2; #9 (findings 2, 3).*

## 11. Built-in tools

Three tools live in the kernel-reserved `switchboard.*` namespace ([kernel spec §2.4](./kernel-api.md#24-prefixes-and-the-reserved-namespace)), are always registered, and MUST either work or fail with actionable errors whether or not a page is connected. They are the reliable floor for list-once clients that never process change notifications.

### 11.1 `switchboard.status`

Reports connection truth: whether a page is connected; all connected tabs with their stable tab ids and which is active (§13); bridge and page protocol versions and kernel API versions (diagnostics, §2); the most recent handshake rejection, if any (§5.3); canonical-registry command count; tail-buffer entry count; live agent-session count. With no page connected it MUST say exactly that, with the remedy.

### 11.2 `switchboard.context.read`

Takes a context key; performs a live round-trip (§8) against the active tab and returns the value with its writing plugin id, or an actionable error: key unset, value not agent-visible (`not-granted`), or no page connected.

### 11.3 `switchboard.events.tail`

Serves the tail buffer (§9.2), newest-last, with each entry's name, payload, plugin id, tab id, timestamp, and sequence number; MAY accept a limit and a since-sequence cursor. It keeps serving buffered entries with no page connected — including events recorded before a disconnect.

*Consolidates: #11 (decisions 1, 2, 12); validated by #9 (built-ins truthful with and without a page).*

## 12. Where the plain-JSON rule is enforced

The plain-JSON rule is defined once, in [kernel spec §14](./kernel-api.md#14-the-plain-json-rule): both the definition and its unconditional binding on Command inputs/results, Event payloads, and Context values. The kernel never deep-inspects payloads. The bridge enforces the rule, and this section says how.

Enforcement happens where serialization already happens (the page-side channel edge and the bridge's MCP edge), not in a separate validation pass:

- A value that cannot survive strict JSON serialization MUST become a [loud](./diagnostics.md#21-loud-errors), attributed error that names the responsible plugin and the command (for inputs/results), event name, or context key. Never a silent mangling: no dropped `undefined`s pretending nothing happened, no `{}`-ified `Map`s.
- Enforcement is unconditional: it applies to every value crossing the bridge, regardless of which grants are held ([kernel spec §14.2](./kernel-api.md#142-binding)).
- At the agent edge these surface as `isError` tool results (§10.5); page-side they surface as [loud errors](./diagnostics.md#21-loud-errors) attributed to the acting plugin.

*Consolidates: #12 (via kernel spec §14), #11.*

## 13. Active tab and multi-tab

### 13.1 One logical surface

The agent-facing surface (tool list, context reads, invocations) MUST NOT vary per agent connection. (The 2026-era MCP spec makes this mandatory; it is the right model regardless.) Multi-tab therefore resolves to one active tab rather than per-session tab affinity.

### 13.2 The active-tab model

- Every connected tab maintains its own connection, handshake, and snapshot; the bridge retains each tab's latest snapshot as that tab's registry (§6.3).
- The **active tab** is the most recently focused connected tab, falling back to the most recently connected. Pages MUST send a lightweight `focus` notification when they gain focus:

  ```ts
  interface Focus { type: 'focus' }
  ```

- The canonical agent-facing registry mirrors the active tab's registry; invocations and context reads target the active tab. Switching active tab is a legal over-time list change, delivered as an ordinary diff (§6.3). If the active tab disconnects and another tab remains, the bridge fails over to it (subject to the grace period, §14.2).

### 13.3 Tab ids

Every page connection receives a **stable tab id**, minted by the bridge at handshake acceptance (`hello-ok`, §5.2) and stable for the connection's lifetime. In v1 tab ids route nothing. They are surfaced in `switchboard.status` and on tail-buffer entries, and reserved so explicit tab targeting can arrive later as an optional tool argument (the server-minted-handle pattern) without a breaking change.

*Consolidates: #11 (decision 11); #2 (§2, §6); validated by #9 (focus-driven switching, failover).*

## 14. Page absence and reconnection

### 14.1 The endpoint stays up

With no page connected, the MCP endpoint keeps serving and the built-ins keep their promises (§11): `status` says exactly what is wrong, `events.tail` serves its buffer, `context.read` errors actionably. Invoking a page command answers with an actionable `isError` (§10.5).

### 14.2 The grace period

When a page's channel drops, its commands remain listed for a short grace period before being removed. The grace period MUST be long enough that an ordinary page reload reconnects inside it; a default of 3 seconds is RECOMMENDED. A page that reconnects in time re-announces an identical snapshot and the diff suppresses all churn (§6.3) — the common reload causes zero agent-visible change. Only a genuinely absent page shrinks the list, which then tells the truth: built-ins only (or failover to another connected tab, §13.2).

Calls landing in the gap get the actionable `isError`, never a protocol-level "unknown tool" (§10.5).

### 14.3 Reconnection

Reconnection is deliberately unremarkable: fresh handshake + fresh snapshot (§5.1, §6.1) — the same messages as first connect; there is no resumption or resync protocol, and the bridge requires no persistence for correctness. Dev-server restarts kill both paths together and force the page to reload and reconnect; sudden whole-process death MUST be treated as routine: Next-style dev children are re-forked on config edits and memory pressure as normal operation. Client-side reconnect mechanics (backoff, channel establishment, disconnect signaling) are [adapter-contract obligations](./adapter-contract.md#3-the-page-channel), not the Switchboard protocol: Vite's channel provides them natively; other adapters must implement them.

Agent-side reconnection is the MCP client's job per its protocol era; the bridge's only obligation is §10.1 — a fresh `tools/list` is always the truth.

### 14.4 What dies with the server

The tail buffer and all connection state are in-memory and die with the dev server. This is a documented property, not a defect: Switchboard is not a system of record.

*Consolidates: #11 (decisions 12, 14); #17 (re-fork tolerance); validated by #9 (grace period, restart, reload).*

## 15. Security model (auth v1)

v1's threat model is the malicious website vs. the localhost dev server (DNS rebinding, cross-site WebSocket hijacking). It is not a boundary against local processes: a localhost attacker has already won.

### 15.1 Binding

Both paths MUST bind loopback only. Implementations SHOULD bind both loopback literals (`127.0.0.1` and `::1`): Node resolves `localhost` inconsistently across versions and platforms, and a single-literal bind strands clients on the other literal (#9, finding 4). Documentation SHOULD tell agents to use `localhost`.

### 15.2 Agent path: Origin allowlist

The MCP endpoint MUST validate the `Origin` header against an allowlist of dev origins and refuse disallowed origins before any protocol processing. Requests without an Origin header (terminal agents) MUST be admitted — the allowlist refuses browser-borne cross-origin traffic, not non-browser clients. *(Note: the MCP TS SDK's DNS-rebinding protection implements exactly this but ships off by default — the bridge turns it on.)*

### 15.3 Page path: channel security

Browsers always send `Origin` on WebSocket handshakes (RFC 6455) but never enforce anything — the server must. The page channel MUST be protected by either riding a channel with its own handshake protection (Vite's post-CVE token handshake) or enforcing an Origin allowlist / token check itself. An adapter supplying an alternative channel inherits this obligation ([adapter contract §4](./adapter-contract.md#4-security)); the RECOMMENDED default allowlist is any loopback origin, with strict origin pinning configurable.

### 15.4 The reserved `auth` field

There is no bearer-token machinery in v1 — first run is zero-config. The `hello` message reserves an optional `auth` field (§5.1): v1 bridges MUST tolerate and ignore it, so a production-grade adapter can demand and verify credentials without a protocol version bump. Production deployment is thereby not foreclosed, merely out of v1's scope.

### 15.5 Hosting constraint

`bridge-mcp`'s HTTP edge SHOULD remain operable over both Node `req`/`res` (the dev mounts) and web-standard `Request`/`Response` (the earmarked production route-handler path), so the future production adapter reuses the same edge rather than forking it.

*Consolidates: #11 (decision 13); #9 (finding 4, no-Origin admission confirmed); #17.*

## 16. Forward compatibility

The version bumps only on breaking protocol changes (§2). Additive evolution (new message types, new optional fields, new built-in tools) rides the tolerance rule (§4.3) without a bump.

Shaped-to-be-additive future work, deliberately not v1:

- **`auth` handshake verification** (§15.4) — the production-adapter path.
- **Explicit tab targeting** — an optional tool argument carrying a tab id (§13.3).
- **Context as MCP resources** — the Context ↔ `resources/updated` mapping (§10.2), attractive but blocked on client support; would land beside, not instead of, `switchboard.context.read`.
- **Per-command timeout overrides** (§7.4).
- **Per-registration `bridged: false` opt-outs** ([kernel spec §15](./kernel-api.md#15-versioning-and-forward-compatibility)).
- **SSE+POST page-leg fallback** — assessed, documented as inferior to a real duplex channel, unbuilt (#17).

*Consolidates: #11, #16, #17.*
