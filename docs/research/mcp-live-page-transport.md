# MCP spec & TypeScript SDK for a dev-server-hosted bridge with a live page channel

> Research for wayfinder ticket [bitwhys/switchboard#2]. Researched 2026-08-04 against primary sources.
>
> **Spec revisions covered:** `2025-06-18` and `2025-11-25` (final, initialization-based — what deployed clients speak today) and `2026-07-28` (current — stateless, sessionless). **SDK versions covered:** `@modelcontextprotocol/sdk@1.30.0` (v1, implements up to 2025-11-25) and `@modelcontextprotocol/server`/`@modelcontextprotocol/client@2.0.0` (v2, implements 2026-07-28, published 2026-07-28).
>
> Claims are tagged: **[spec]** = normative spec text, **[sdk]** = verified in SDK source, **[src]** = verified in third-party project source, **[docs]** = project's own docs/README, **[sec]** = secondary source (unverified).

---

## TL;DR + recommended shape

**The single most important finding:** MCP just underwent a breaking architectural shift. The current revision (`2026-07-28`) **removed protocol-level sessions, the `initialize` handshake, the standalone GET SSE stream, SSE resumability (`Last-Event-ID`), and server-initiated JSON-RPC requests** — replacing them with per-request `_meta` versioning, a `subscriptions/listen` long-lived stream for change notifications, and Multi Round-Trip Requests (MRTR) for elicitation/sampling ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). Deployed clients (Claude Code, Cursor, etc.) still largely speak the 2025-era protocol; the v1 TS SDK (`1.30.0`, still `latest` on npm) implements `2025-11-25`. **The bridge must therefore not bake either era's session model into its own design** — and the good news is that Switchboard's locked decisions (own versioned wire protocol page-side, MCP only at the agent-facing edge) already isolate it from this churn.

### Recommended shape (design judgment, grounded in the findings below)

```
agent (Claude Code / Cursor / …)
   │  MCP over Streamable HTTP  —  http://localhost:<devPort>/__switchboard/mcp
   ▼
bridge-mcp (in dev-server process; McpServer instance per MCP connection/session,
   │         all instances projecting ONE shared capability registry)
   │  Switchboard wire protocol (BRIDGE_PROTOCOL_VERSION, JSON, handshake)
   │  over the dev server's WebSocket channel into the page
   ▼
page kernel (capability registry: Commands / Events / Contexts)
```

1. **Agent ↔ bridge: Streamable HTTP, mounted as a path on the dev server's own HTTP server.** Grounds: it is the only spec-defined transport that fits a long-lived server the client didn't launch [spec]; Claude Code's recommended transport is `--transport http` and it accepts `streamable-http` config verbatim [docs]; antfu's `vite-plugin-mcp` and Nuxt MCP already prove the mount-on-dev-server pattern [src]. Run it **stateful** (v1 SDK `sessionIdGenerator`) so 2025-era clients get a GET SSE stream — that stream is the *only* way `notifications/tools/list_changed` reaches an agent outside an active request in the 2025 protocol [spec]. Do **not** use stdio as the primary transport: the client would spawn a private server process, which contradicts "hosted by the dev server" (a thin stdio→HTTP proxy like `mcp-remote` covers stdio-only clients).
2. **Bridge ↔ page: not MCP.** Keep the locked decision. For Vite, ride the existing HMR WebSocket channel (`import.meta.hot.send` / `server.ws.on` with typed `switchboard:*` custom events — buffering and reconnect signaling included for free; see §5.6) carrying the Switchboard wire protocol; keep the bridge core channel-agnostic behind a small duplex-message interface because Next.js has no equivalent pluggable WS (§5.6). The spec explicitly blesses this layering: MCP is "transport-agnostic," and custom transports need only preserve JSON-RPC message shape *if you claim to be an MCP transport* — the page channel doesn't and shouldn't [spec]. Precedent: every surveyed project (chrome-devtools-mcp, Playwright MCP, MCP-B) uses a non-MCP protocol for the browser leg and translates at the bridge [src].
3. **Registry → tool list:** page announces/updates its registry over the wire protocol; the bridge maintains one canonical registry and mirrors it into each connected `McpServer` instance via `registerTool` / `RegisteredTool.update()` / `.remove()`, which **automatically emit `notifications/tools/list_changed`** per connection [sdk]. Declare `tools: { listChanged: true }`.
4. **Multi-tab:** treat the registry as one logical surface. `2026-07-28` makes this mandatory-shaped: `tools/list` "**MUST NOT** vary per-connection" [spec], so per-tab tool sets cannot ride on MCP sessions. Single-active-tab by default; if multi-tab is ever needed, use explicit tab-handle *arguments* (the spec's sanctioned "server-minted handle" pattern) or MCP-B-style name prefixing.
5. **Page not open:** bridge stays up, exposes a small static core (e.g. `switchboard_status`), and returns tool-execution errors (`isError: true`, actionable message: "no page connected — open http://localhost:5173") for registry commands; emits `list_changed` as pages attach/detach. (Design judgment; grounded in MCP's two-tier error model [spec].)
6. **Reconnection:** page reload/HMR = wire-protocol handshake re-announcing the full registry; bridge **diffs** against its canonical state and only emits `list_changed` on real change, debounced. Agent-side reconnection is the MCP client's problem and differs by era (2025: `Last-Event-ID` resume + 404→re-initialize; 2026: re-issue requests, re-open `subscriptions/listen`) — the bridge must treat any notification as lossy-delivery, i.e. `tools/list` is always the source of truth, notifications are only cache-invalidation hints [spec].

---

## 1. MCP transports

### What the spec defines

**Both eras define exactly two standard transports: stdio and Streamable HTTP.** No WebSocket transport is specified in any revision.

- **stdio** — client launches the server as a subprocess; newline-delimited JSON-RPC on stdin/stdout; "The server **MUST NOT** write anything to its `stdout` that is not a valid MCP message"; stderr is free for logging. "Clients **SHOULD** support stdio whenever possible" (2025-11-25). ([2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [2026-07-28 stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)) [spec]
  - *Implication for Switchboard:* stdio structurally cannot be the bridge transport — the dev server hosts the MCP server; nobody's client is going to spawn the dev server as a subprocess per conversation.
- **Streamable HTTP** — a single "MCP endpoint" path; every client JSON-RPC message is its own HTTP POST; the server answers each request with either `application/json` (single object) or a `text/event-stream` SSE stream scoped to that request. ([2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)) [spec]. Details differ sharply by era — see §2 and §3.
- **HTTP+SSE (2024-11-05)** — deprecated since `2025-03-26`, formally classified Deprecated under the feature-lifecycle policy in `2026-07-28` (SEP-2596): "New implementations **SHOULD NOT** adopt it." ([2026-07-28 backward compat](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#http-sse-transport-2024-11-05)) [spec]. The bridge should never implement it.
- **Custom transports are explicitly permitted**: "Clients and servers **MAY** implement additional custom transport mechanisms… The protocol is transport-agnostic and can be implemented over any communication channel that supports bidirectional message exchange." Custom transports "**MUST** preserve the JSON-RPC message format" (+ lifecycle in 2025-11-25; + message patterns and per-request metadata model in 2026-07-28). 2026-07-28 adds: custom transports over a reliable byte stream "**SHOULD** reuse the stdio framing" (newline-delimited JSON-RPC). ([2026-07-28 custom transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports#custom-transports), [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#custom-transports)) [spec]
  - So **MCP-over-WebSocket is legal as a custom transport** but non-standard: no interop guarantee with off-the-shelf clients unless they ship a WS transport.

### What the TypeScript SDK ships

**v1 (`@modelcontextprotocol/sdk@1.30.0`, npm `latest`; `LATEST_PROTOCOL_VERSION = '2025-11-25'`, supports back to `2024-10-07`)** ([types.ts L4-6](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.30.0/src/types.ts)) [sdk]:

| Transport | Server side | Client side |
|---|---|---|
| stdio | `StdioServerTransport` | `StdioClientTransport` |
| Streamable HTTP | `StreamableHTTPServerTransport` (Node wrapper) + `WebStandardStreamableHTTPServerTransport` (fetch-API runtimes: Workers/Deno/Bun) | `StreamableHTTPClientTransport` |
| HTTP+SSE (deprecated) | `SSEServerTransport` | `SSEClientTransport` |
| WebSocket | **none** | `WebSocketClientTransport` (`src/client/websocket.ts`, subprotocol `'mcp'`) |
| In-memory | `InMemoryTransport` (linked pair, same process) | same |

- The **`Transport` interface** is small and implementable in ~50 lines: `start()`, `send(message, opts?)`, `close()`, callbacks `onmessage`/`onclose`/`onerror`, optional `sessionId`/`setProtocolVersion` ([shared/transport.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.30.0/src/shared/transport.ts)) [sdk]. This is the seam every ecosystem project plugs into (MCP-B's postMessage transports, etc.).
- **Browser-capable pieces:** `WebSocketClientTransport`, `StreamableHTTPClientTransport` (fetch-based), and `InMemoryTransport` run in browsers; `WebStandardStreamableHTTPServerTransport` runs anywhere with web-standard `Request`/`Response`. There is **no WebSocket *server* transport** in the SDK (verified against the full `src/` tree at tag 1.30.0) [sdk] — if the bridge ever wanted MCP-over-WS it would write a custom `Transport` around `ws`, and only WS-capable clients could connect.
- **Claude Code as client** supports `--transport stdio`, `--transport http` ("recommended… `streamable-http` accepted as alias"), `--transport sse` (deprecated), **and a config-only `type: "ws"` WebSocket transport** ("suits remote MCP servers that push events to Claude unprompted… supports neither OAuth nor the `--transport` flag") ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)) [docs]. WS support in other clients is not evidenced — don't depend on it.

**v2 (`@modelcontextprotocol/server` / `@modelcontextprotocol/client@2.0.0`, published 2026-07-28)** implements the `2026-07-28` spec; packages split per side plus framework adapters (`@modelcontextprotocol/express`, `/fastify`, `/hono`); transports: stdio (`serveStdio`), streamable HTTP, no WebSocket ([main-branch README](https://github.com/modelcontextprotocol/typescript-sdk), [v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/)) [docs]. v1 remains "the stable release line" with its own docs and a v2 migration guide [docs].

## 2. Session semantics & multiple simultaneous clients

### 2025-11-25 era (what deployed clients speak)

([2025-11-25 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http)) [spec]:

- **Sessions:** server **MAY** mint an `Mcp-Session-Id` header on the `InitializeResult`; if it does, clients "**MUST** include it… on all of their subsequent HTTP requests"; missing header → 400. Server may terminate a session at any time → 404, after which the client "**MUST** start a new session by sending a new `InitializeRequest`". Client `DELETE` = explicit session termination (server may 405).
- **Resumability:** servers **MAY** attach SSE event `id`s (globally unique per session, per-stream cursor semantics); client resumes with `GET` + `Last-Event-ID`; server **MAY** replay missed messages from *that stream only* ("**MUST NOT** replay messages that would have been delivered on a different stream").
- **Multiple clients = multiple sessions.** The transport is explicitly built for "multiple client connections"; each session is an independent logical channel. Nothing in the 2025 spec forbids the tool list varying per session — but see below, the 2026 spec now forbids it, so *don't design for per-session tool lists*.
- **Stateless option:** a server can simply not mint a session ID. In the v1 SDK this is `sessionIdGenerator: undefined` — the transport then refuses to be reused across requests ("In stateless mode… each request must use a fresh transport") [sdk]. Stateless servers can't push anything between requests, so **stateless mode is wrong for the bridge in the 2025 era** (no channel for `list_changed`).

**v1 SDK mechanics** ([webStandardStreamableHttp.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.30.0/src/server/webStandardStreamableHttp.ts)) [sdk]:

- Options: `sessionIdGenerator` (stateful vs stateless), `enableJsonResponse`, `eventStore` (opt-in resumability/replay; `InMemoryEventStore` example ships in the repo), `allowedOrigins`/`allowedHosts` + `enableDnsRebindingProtection`.
- One standalone GET SSE stream per session (`_standaloneSseStreamId = '_GET_stream'`; a second GET conflicts).
- **One `Protocol` (hence `Server`/`McpServer`) instance per connection**: `connect()` throws `'Already connected to a transport… use a separate Protocol instance per connection.'` ([shared/protocol.ts L607](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.30.0/src/shared/protocol.ts)) [sdk]. **Consequence: with N agents attached to the dev server, the bridge holds N `McpServer` instances.** The shared thing must be Switchboard's own registry object, with a fan-out layer that applies every registry mutation to each live instance (each then emits its own `list_changed`). This is the central piece of state architecture `bridge-mcp` has to own.
- Security defaults matter for a dev server: the spec requires Origin validation ("Servers **MUST** validate the `Origin` header… to prevent DNS rebinding attacks"; invalid → 403) and recommends binding localhost only [spec] — but the SDK's `enableDnsRebindingProtection` **defaults to `false`** [sdk], so the bridge must turn it on / enforce Origin itself. A dev server is exactly the localhost-server-vs-malicious-website scenario the spec warns about.

### 2026-07-28 era (current spec)

([Streamable HTTP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)) [spec]:

- **Sessions removed** (SEP-2567): no `Mcp-Session-Id`, no `initialize` handshake (SEP-2575); every request self-describes via `_meta` (`io.modelcontextprotocol/protocolVersion`, `clientInfo`, `clientCapabilities`) mirrored into headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` are **REQUIRED**). New mandatory `server/discover` RPC advertises versions/capabilities.
- **"List endpoints (`tools/list`, …) no longer vary per-connection."** Normatively: the tool set "**MUST NOT** vary per-connection or as a side effect of other requests on the connection" (it **MAY** vary by per-request authorization) ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities)). Cross-call state must use "explicit, server-minted handles passed as ordinary tool arguments" — the spec's non-normative "Stateful Tools" section spells out the handle pattern (opacity, lifetime, expiry errors).
- **Resumability removed** (SEP-2575): "Resumable SSE streams via `Last-Event-ID` are not supported… A broken response stream loses the in-flight request; clients **MUST** re-issue it."
- Legacy compat is specified in both directions (modern server answering old clients: 405 on GET/DELETE, ignore `Mcp-Session-Id`; era-detection via probing) — the v1 SDK will keep working against era-aware clients for a long time, and v2 handles the modern side.

**Bridge takeaway:** never key bridge behavior off the MCP session. Sessions exist in 2025-era only as a transport bookkeeping detail (which the SDK handles); anything Switchboard-meaningful (tab identity, pending command state) belongs in Switchboard's own layer or in explicit tool arguments/handles, which is exactly the pattern the 2026 spec canonizes.

## 3. Server-initiated messages

### 2025-11-25 era

- On POST-response SSE streams the server may send requests/notifications *related to that request* (progress, logging); on the **standalone GET SSE stream** it may send anything unrelated — this is where `notifications/tools/list_changed`, `notifications/resources/updated`, and server→client requests (`sampling/createMessage`, `elicitation/create`, `roots/list`) travel. "The client **MAY** issue an HTTP GET… allowing the server to communicate to the client, without the client first sending data via HTTP POST"; server without such a stream → 405 ([2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)) [spec].
- **Hard constraint:** if no client has an open GET stream (or in-flight request), the server has nowhere to push a notification. Delivery is best-effort; a client that never GETs simply never hears `list_changed`. The SDK silently drops notifications when not connected (`sendToolListChanged()` is a no-op `if (!isConnected())`) [sdk].
- v1 SDK surfaces: `server.sendToolListChanged()` / `sendResourceListChanged()` / `sendPromptListChanged()` / `sendLoggingMessage()` / `server.createMessage()` (sampling) / `server.elicitInput()` — all on the per-connection `Server` [sdk].

### 2026-07-28 era

- **Servers no longer initiate JSON-RPC requests at all**: "servers do not initiate JSON-RPC requests and clients do not send JSON-RPC responses" ([transports overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports#messages)) [spec]. Sampling/elicitation/roots became **MRTR**: the server returns `resultType: "input_required"` with `inputRequests`; the client retries the original call with `inputResponses` (SEP-2322). Roots, Sampling, and Logging are additionally **Deprecated** as features (SEP-2577).
- **Change notifications moved to `subscriptions/listen`** ([subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)) [spec]: client POSTs `subscriptions/listen` with a filter (`toolsListChanged: true`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions: [uris]`); the response is a long-lived SSE stream; server **MUST** ack first (`notifications/subscriptions/acknowledged`) and "**MUST NOT** send notification types the client has not explicitly requested." Notifications carry `io.modelcontextprotocol/subscriptionId`. Graceful server close = empty result to the listen request. After a drop, the client re-subscribes; there is **no replay** — missed notifications are simply lost, and the client re-lists.
- For the bridge this is the same design either way: **notifications are lossy cache-invalidation signals; `tools/list` is the source of truth.** Design the registry mirror so a fresh `tools/list` is always correct regardless of notification delivery.

## 4. Dynamic tool registries in the TS SDK

This is the strongest SDK story for Switchboard — the v1 `McpServer` is *built* for a mutable registry ([server/mcp.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.30.0/src/server/mcp.ts)) [sdk]:

- `registerTool(name, { title?, description?, inputSchema, outputSchema?, annotations?, _meta? }, handler)` returns a **`RegisteredTool`** handle: `{ enabled, enable(), disable(), update({...}), remove() }`. `update()` can change name, schemas, description, annotations, callback, enabled.
- **Every mutation auto-emits `notifications/tools/list_changed`**: `_createRegisteredTool` calls `this.sendToolListChanged()` on registration, and `update()` (which `enable`/`disable`/`remove` delegate to) ends with `this.sendToolListChanged()`. Guarded by `isConnected()` — mutations before/without a connection are silently not notified (fine: the next `tools/list` sees them).
- Registering any tool makes the server declare `tools: { listChanged: true }` capability automatically (mcp.ts L134) [sdk]. Spec: "`listChanged` indicates whether the server will emit notifications when the list of available tools changes"; servers that declared it "**SHOULD** send" the notification on change ([tools, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#capabilities)) [spec].
- Disabled tools are filtered from `tools/list`; calls to them fail. `remove()` deletes the entry.
- **Gotcha — no debouncing:** N registrations = N notifications. A page announcing 30 commands on reconnect would fire 30 `list_changed` per connected agent, each typically triggering a client re-list. The bridge should batch registry deltas (one mirror pass per wire-protocol message, or microtask-debounced) before touching the `McpServer` instances. (SDK behavior verified [sdk]; batching is design judgment.)
- **Gotcha — per-instance:** `sendToolListChanged()` notifies *that instance's* transport only. With one `McpServer` per agent session (§2), the registry fan-out must iterate all live instances.
- **Annotations round-trip cleanly.** `ToolAnnotations` in the MCP schema is exactly Switchboard's Command shape: `readOnlyHint` ("If true, the tool does not modify its environment." default `false`), `destructiveHint` ("may perform destructive updates… meaningful only when `readOnlyHint == false`", default `true`), `idempotentHint` ("calling the tool repeatedly with the same arguments will have no additional effect", default `false`), `openWorldHint` (default `true` — Switchboard commands are closed-world; consider always sending `false`) ([schema/2025-06-18/schema.ts](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-06-18/schema.ts)) [spec]. Both eras warn: "clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers" — annotations are hints for UX/policy, not security ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool)) [spec].
- Schemas: `inputSchema`/`outputSchema` are JSON Schema (2020-12 default dialect; 2026-07-28 loosened them to allow any 2020-12 keywords, SEP-2106). If `outputSchema` is present, "Servers **MUST** provide structured results that conform to this schema" and clients SHOULD validate [spec] — so the bridge should validate page-returned command results against `outputSchema` before answering, or strip `outputSchema` when the page plugin's schema isn't trustworthy.
- Tool names: `[A-Za-z0-9_.-]`, ≤128 chars, unique per server, case-sensitive [spec] — the wire protocol must enforce/sanitize command names at registration time (v1 SDK has `validateAndWarnToolName` but it only warns [sdk]).
- v2 SDK keeps `registerTool(name, config, handler)` and implements the `subscriptions/listen` delivery of `list_changed` ([v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/)) [docs].

### Client support for `list_changed` in practice (ecosystem observations — mostly [sec])

- **Claude Code: supported.** Official docs: "Claude Code supports MCP `list_changed` notifications… When an MCP server sends a `list_changed` notification, Claude Code automatically refreshes the available capabilities from that server," keeping stale lists if a refresh fails ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)) [docs]. It was broken before ~v2.1.0 ([issue #13646](https://github.com/anthropics/claude-code/issues/13646)) [sec].
- **Claude Desktop: historically non-compliant** ([issue #50339](https://github.com/anthropics/claude-code/issues/50339), [discussion #76](https://github.com/orgs/modelcontextprotocol/discussions/76)) [sec].
- **Cursor and others: unverified;** community reports are mixed [sec].
- **Conclusion:** treat `list_changed` as progressive enhancement. The bridge should work acceptably for a client that only calls `tools/list` once per conversation — which argues for registering the page's expected command surface as early/stably as possible and for a `switchboard_status`-style tool that lets an agent ask "what's live right now" imperatively.

## 5. How existing projects bridge agent ↔ browser

All third-party findings below were verified in project source by sub-investigations unless marked otherwise; a consistent pattern holds: **MCP at the agent edge, a non-MCP protocol at the browser edge, translation in the middle — and static tool lists everywhere** (Switchboard's dynamic registry is genuinely novel among these).

### 5.1 chrome-devtools-mcp (Google) — CDP attach

- Agent edge: **stdio only** (`StdioServerTransport` in [`src/bin/chrome-devtools-mcp-main.ts`](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/bin/chrome-devtools-mcp-main.ts)) [src]. Multi-client is solved out-of-band by a **daemon over Unix sockets/named pipes** that multiplexes CLI clients onto one MCP server + browser, keyed by `CHROME_DEVTOOLS_MCP_SESSION_ID` ([src/daemon/daemon.ts](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/daemon/daemon.ts)) [src].
- Browser edge: **Chrome DevTools Protocol via Puppeteer** — launches Chrome or attaches (`browserWSEndpoint`, `browserURL`, or auto-discovery via the profile's `DevToolsActivePort` file) ([src/browser.ts](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/browser.ts)) [src]; lazy launch on first tool needing a browser [docs].
- **Static tool list**, registered once at startup; no `tools/list_changed` emission found [src]. Tabs: explicit `list_pages`/`select_page` tools + experimental `pageId` routing flag [docs]. No auto-reconnect; reuses `browser.connected` or reconnects on next call [src].

### 5.2 Playwright MCP (Microsoft) — automation channel, plus an extension relay

(Source now lives in the Playwright monorepo, `packages/playwright-core/src/tools/mcp` [src].)

- Agent edge: **stdio default; `--port` starts an HTTP server** serving Streamable HTTP at `/mcp` ([program.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/mcp/program.ts)) [src][docs].
- Browser edge: Playwright's own driver protocol over CDP — launch, `--cdp-endpoint` attach, or **`--extension` mode**: a local **WebSocket relay** (`CDPRelayServer`) with per-session UUID endpoints `/cdp/{uuid}` and `/extension/{uuid}`; a Chrome extension in the user's real browser dials back over WS and CDP is relayed into the live, logged-in tab ([cdpRelay.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/mcp/cdpRelay.ts)) [src]. This "page dials out to a local WS endpoint" topology is the closest existing analogue to Switchboard's page↔dev-server channel.
- **Static, capability-gated tool list** (`--caps`); one `browser_tabs` tool; per-HTTP-client browser isolation by default, `--shared-browser-context` opt-in [src][docs]. Extension mode: disconnect on either side tears down the pair, no auto-reconnect [src].

### 5.3 faster-fixes — store-and-forward, no live channel

- Architecture: React capture widget in the page → **HTTP POST to a persistent backend** (Next.js/Prisma) → thin **stdio** MCP server that just wraps the backend's HTTP API with 3 static tools (`list_feedbacks`, `create_feedbacks`, `update_feedback_status`) ([repo](https://github.com/manucoffin/faster-fixes)) [src].
- **The MCP server never talks to the browser.** Store-and-forward makes multi-tab/page-not-open/reconnection non-problems — at the cost of no live invocation. Instructive as the *opposite* pole of the design space: Switchboard's Events/Context replay could borrow buffering ideas from this, but Commands require the live channel.

### 5.4 MCP-B / WebMCP (community) — in-page MCP servers; the transport blueprint

The most relevant prior art. The original repo ([MiguelsPizza/WebMCP](https://github.com/MiguelsPizza/WebMCP)) is now historical (extension closed-source; effort moved to W3C + [WebMCP-org](https://github.com/WebMCP-org/npm-packages)) [src].

- **`@mcp-b/transports`** implements the SDK `Transport` interface over browser channels ([source](https://github.com/WebMCP-org/npm-packages/tree/main/packages/transports/src)) [src]:
  - Envelope on every `postMessage` frame: `{ channel, type: 'mcp', direction: 'client-to-server' | 'server-to-client', payload }` — `direction` prevents same-window echo; `channel` multiplexes sessions.
  - `TabServerTransport` (in-page server): constructor **requires `allowedOrigins`**; validates `event.source === window` + origin + Zod `JSONRPCMessageSchema` before delivery. **Readiness handshake:** broadcasts `'mcp-server-ready'` on start, answers `'mcp-check-ready'`, posts `'mcp-server-stopped'` on close.
  - `TabClientTransport`: **throws unless `targetOrigin` set**; `serverReadyPromise`; *not restartable after close* (a gap — a dev bridge needs reconnect-on-reload instead).
  - `ExtensionServerTransport`/`ExtensionClientTransport` over `chrome.runtime` ports, with a 25s keep-alive purely to defeat MV3 service-worker teardown.
- **Hub architecture** ([MCP-B Protocol.md](https://github.com/MiguelsPizza/WebMCP/blob/main/MCP-B%20Protocol.md)) [src]: content-script proxy is an MCP *client* to the page; a background hub aggregates all tabs and is itself an MCP *server* outward. **Tool namespacing** `website_tool_{domain}_{tabN}_{name}`; **routing** active-tab → freshest-tab → spawn-tab; **tool caching** (`cache: true` tools survive tab close and can trigger tab creation); **dynamic updates via standard `ToolListChanged`** with a 60s polling fallback.
- Lessons Switchboard should copy: envelope discipline (channel + direction), explicit origin validation, readiness handshake, diff-based update notifications; lesson to avoid: non-restartable client transports.

### 5.5 W3C WebMCP proposal & Chrome native

- **Spec:** "WebMCP," Draft Community Group Report, **28 July 2026**, W3C Web Machine Learning CG ([spec](https://webmachinelearning.github.io/webmcp/), [repo](https://github.com/webmachinelearning/webmcp)); champions from **Microsoft** (Walderman, Lee) and **Google** (Bokan, Sagar) [src].
- **API shape:** `document.modelContext` (moved from `navigator.modelContext`, which Chrome's trial still ships) with `registerTool({ name, description, inputSchema, execute, annotations? }, { signal?, exposedTo? })`, `getTools()`, and a **`"toolchange"` event** on register/unregister; AbortSignal-based unregistration; tool names 1–128 chars `[A-Za-z0-9_.-]`; annotations include `readOnlyHint` [src].
- **It is not MCP-the-protocol** — no JSON-RPC, no transports; a browser-native tool registration surface sharing MCP vocabulary; the browser agent plays the client role [src].
- **Chrome status (primary sources):** chromestatus feature 5117755740913664 — DevTrial Chrome 146, **Origin Trial Chrome 149→156**, shipping targeted **Chrome 157** per the blink-dev Intent to Experiment (2026-05-15); Firefox/Safari "no signal" ([chromestatus](https://chromestatus.com/feature/5117755740913664), [Chrome blog 2026-06-09](https://developer.chrome.com/blog/ai-webmcp-origin-trial)) [src]. The Chrome OT blog explicitly names **"efficient application debugging" via agent-accessible dev tools** as a target use case — directly adjacent to Switchboard.
- **Strategic implication (design judgment):** Switchboard's Command registration surface should stay *shape-compatible* with `ModelContext.registerTool` (name/description/inputSchema/execute/annotations + change events) so a future `adapter-webmcp` can mirror the same registry into `document.modelContext` for browser-native agents, while `bridge-mcp` serves out-of-browser agents. The two channels are complementary, not competing.

### 5.6 Vite dev-server WebSocket (the likely `adapter-vite` channel)

State as of Vite 8.2.0 docs; APIs stable across Vite 6/7/8 unless noted.

- **Client API — `import.meta.hot`** ([api-hmr](https://vite.dev/guide/api-hmr)) [docs]: `hot.send(event, data)` — "If called before connected, the data will be buffered and sent once the connection is established" (free send-buffering for the kernel); `hot.on(event, cb)`/`hot.off`; built-in **`vite:ws:connect` / `vite:ws:disconnect`** events for connection-state UI/resync. Custom event payloads are typed by augmenting `CustomEventMap` in `vite/types/customEvent.d.ts` ([api-plugin](https://vite.dev/guide/api-plugin#client-server-communication)) — Switchboard should ship typed `switchboard:*` events.
- **Server API — `server.ws` is current and documented** ([api-plugin: client-server communication](https://vite.dev/guide/api-plugin#client-server-communication)) [docs]: `server.ws.on('switchboard:x', (data, client) => client.send('switchboard:ack', …))` for per-client replies, `server.ws.send()` to broadcast; docs advise prefixing event names. `client` exposes `send(event, payload)` plus the raw `ws` socket [src]. **`server.hot` is deprecation-warned** (`removeServerHot` future flag) as an alias of `server.environments.client.hot`; the Environment API (`DevEnvironment.hot: NormalizedHotChannel` — `send`/`on`/`off`/`listen`/`close`, `vite:client:connect`/`vite:client:disconnect` per-connection events) is the forward-compatible way to read the same channel ([api-environment](https://vite.dev/guide/api-environment), [per-environment-apis](https://vite.dev/changes/per-environment-apis)) [docs][src]. Use `server.ws` (or `server.environments.client.hot`), never `server.hot`.
- **A plugin-owned separate WS endpoint is possible**: Vite's upgrade handler only claims `sec-websocket-protocol: vite-hmr|vite-ping` upgrades on its own path, so `configureServer` can attach `server.httpServer.on('upgrade', …)` + `new ws.WebSocketServer({ noServer: true })` routed by pathname (e.g. `/__switchboard/ws`) ([vite ws.ts](https://github.com/vitejs/vite/blob/main/packages/vite/src/node/server/ws.ts)) [src]. Caveats: must not claim Vite's upgrades (documented breakage: [fastify-vite#129](https://github.com/fastify/fastify-vite/issues/129)); and since [CVE-2025-24010](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6) Vite's own channel is protected by a `?token=` handshake (timing-safe check) — a custom endpoint gets none of that and **must implement its own Origin/token validation** [src].
- **Plain HTTP endpoints via connect middleware are the proven MCP mount**: `server.middlewares.use('/__switchboard/mcp', handler)` in `configureServer` receives raw Node `req`/`res` and can stream. **antfu's `vite-plugin-mcp`** (in [antfu/nuxt-mcp](https://github.com/antfu/nuxt-mcp), used by `@nuxt/mcp`) mounts an `McpServer` exactly this way at `/__mcp/sse` — though with the *legacy* `SSEServerTransport` and a per-`sessionId` transport pool ([connect.ts](https://github.com/antfu/nuxt-mcp/blob/main/packages/vite-plugin-mcp/src/connect.ts)) [src]; nothing prevents mounting `StreamableHTTPServerTransport` on one path the same way (branch on `req.method` yourself — connect does no method routing).
- **Reconnection reality** ([client.ts](https://github.com/vitejs/vite/blob/main/packages/vite/src/client/client.ts)) [src]: on server restart the Vite client polls with `vite-ping` and then **`location.reload()`s the page** — page state is discarded; on plain page reload the module graph re-executes. Either way the kernel's channel is ephemeral and re-registration on every page load is the natural (and only) model. This is why the bridge must own the canonical registry and diff on re-announce.
- **Verdict for `adapter-vite` (design judgment):** ride the existing HMR channel (`hot.send`/`server.ws`) with `switchboard:`-prefixed typed events — no extra socket, buffering and reconnect signaling included; open a dedicated WS endpoint only if non-page peers or binary/backpressure needs appear.
- **Next.js contrast** (for `adapter-next`): no public API for custom dev-time WS channels; `/_next/webpack-hmr` is internal and Route Handlers can't accept WS upgrades ([discussion #58698](https://github.com/vercel/next.js/discussions/58698), [RFC #95514](https://github.com/vercel/next.js/discussions/95514)) [docs]. Options are a [custom server](https://nextjs.org/docs/app/guides/custom-server) (own `upgrade` handling, forwarding HMR upgrades to `app.getUpgradeHandler()`; incompatible with `standalone` output) or SSE/long-polling from a route handler. The bridge core must therefore not assume a WebSocket — it should be channel-agnostic over a small duplex-message interface the adapters implement (Vite: HMR channel; Next: custom-server WS or SSE+POST).

## 6. Constraints imposed on the bridge design

Hard constraints (spec/SDK-grounded):

1. **No spec-standard WebSocket MCP transport exists, and the TS SDK has no WS server transport** — agent↔bridge must be Streamable HTTP (or stdio-via-proxy); page↔bridge WS must be Switchboard's own protocol, not "MCP over WS," if off-the-shelf client interop is the goal. [spec][sdk]
2. **Server-push requires a client-opened stream in both eras** (2025: GET SSE; 2026: `subscriptions/listen`) and **delivery is lossy with no cross-era replay guarantee** (resumability was removed in 2026-07-28). Therefore: `tools/list` must always be reconstructible from the bridge's canonical registry; `list_changed` is only an invalidation hint. [spec]
3. **One `Protocol`/`McpServer` instance per MCP connection** (v1 SDK throws otherwise) → the bridge needs an instance-per-agent-session layer over one shared registry, with mutation fan-out. [sdk]
4. **`tools/list` MUST NOT vary per-connection (2026-07-28)** → tab/page targeting cannot live in MCP sessions; it must be tool arguments/handles or a single logical surface. Design the wire protocol's tab model accordingly *now*. [spec]
5. **The 2025→2026 protocol break is real and clients straddle it** → pin `bridge-mcp` to the SDK (v1 today) and treat MCP-era compatibility as the SDK's job; keep `BRIDGE_PROTOCOL_VERSION` fully independent of MCP protocol versions. [spec][sdk]
6. **Origin validation is mandatory** ("Servers MUST validate the `Origin` header… DNS rebinding") and the SDK's protection is off by default → bridge must configure `allowedOrigins`/hosts for both the MCP endpoint *and* the page WS endpoint; bind localhost. [spec][sdk]
7. **Tool naming/schema rules**: names `[A-Za-z0-9_.-]` ≤128 unique-per-server; `inputSchema` must be a valid JSON Schema object (2020-12 default); if `outputSchema` is declared, results MUST conform → the wire protocol must validate/sanitize command names and schemas at page-registration time, and the bridge must decide validate-or-strip for `outputSchema`. [spec]
8. **`list_changed` requires the declared capability and is only SHOULD-delivered; client support varies (Claude Code yes; others unverified)** → dynamic registry must degrade gracefully for list-once clients. [spec][docs][sec]
9. **Annotations are untrusted hints by spec** — never treat `readOnlyHint` as a security boundary on either side of the bridge. [spec]
10. **Notification storms are the server's problem**: the SDK emits one `list_changed` per mutation with no debounce → the bridge must batch registry deltas per instance. [sdk]

Design-judgment constraints (grounded but not mandated):

11. Page-not-open and page-reload windows are Switchboard's to define: recommend keep-endpoint-up + fail-fast `isError` tool results + registry re-announce handshake + diff-then-notify (precedents: MCP-B readiness handshake and cached tools; faster-fixes store-and-forward for Events).
12. Multi-tab: default single-active-tab with an explicit `switchboard_status`/tab-handle escape hatch (precedents: chrome-devtools-mcp `select_page`, MCP-B hub routing).
13. Keep the page-facing registration API shape-compatible with W3C WebMCP `ModelContext` for a future native-browser channel.

## 7. Open questions

1. **v1 or v2 SDK for `bridge-mcp` at build time?** v1 (2025-11-25) matches deployed clients today; v2 (2026-07-28) is where the ecosystem is heading and its stateless model matches the bridge's "registry is the only truth" design better. Does the v2 server package interoperate with 2025-era clients out of the box (era fallback), or would the bridge need to run both? (v2 migration docs exist but interop behavior wasn't verified here.)
2. **Where exactly to mount the MCP endpoint in `adapter-next`** — Next.js dev server extension points are less pluggable than Vite's (see §5.6 findings); custom-server vs route-handler vs standalone-port fallback needs its own spike.
3. **Should Events/Context cross to agents at all via MCP resources?** `notifications/resources/updated` + `resourceSubscriptions` map suspiciously well onto Switchboard Context (observable state with last-value replay) — but resource subscription client support is even thinner than `list_changed`. Worth a follow-up ticket before committing Context to tools-only exposure.
4. **Multi-agent write contention**: two agents invoking destructive commands on one page has no MCP-level answer (sessions are gone). Does the wire protocol need an advisory lock/queue primitive, or is last-write-wins acceptable for a dev tool?
5. **Chrome WebMCP timing**: if `document.modelContext` ships in Chrome ~157, does Switchboard expose the same registry natively (making the browser itself an agent client), and how do the two channels coexist without double-execution?
