# MCP bridge transport spike — findings

> Validation spike for wayfinder ticket [#9](https://github.com/bitwhys/switchboard/issues/9), run 2026-08-05 against the fourteen locked decisions of [Bridge protocol design #11](https://github.com/bitwhys/switchboard/issues/11). Stack: Vite `8.2.0`, `@modelcontextprotocol/sdk` `1.30.0` (2025-11-25 era, stateful Streamable HTTP), Ajv `8.20.0`, real Chrome page, real MCP SDK client as the agent.

## Verdict

**The locked protocol works end-to-end as specified. No decision is overturned.** Every checklist item in the ticket was demonstrated live: 27/27 automated checks pass (`no-page` 7, `origin` 3, `with-page` 17), plus manually-driven evidence for reload/grace, multi-tab focus switching, handshake rejection, and dev-server restart. Four implementation-level findings below refine *how* the decisions get built — none changes *what* was decided.

## Ticket checklist → evidence

| Checklist item | Result |
|---|---|
| MCP over Streamable HTTP mounted on a Vite dev server, stateful, Origin allowlist ON, localhost-bound | ✅ Mounted at `/__switchboard/mcp` via `server.middlewares.use` in `configureServer`; stateful (`Mcp-Session-Id` + GET SSE stream); server listens on `[::1]:5173` only. Disallowed `Origin: http://evil.example` → **403**; forged `Host: attacker.example` → **403**; allowlisted Origin → 200; **no Origin (terminal agent) → 200** |
| Wire handshake: integer gate, `KERNEL_API_VERSION` alongside, rejection observable | ✅ `?v=999` page → structured `hello-reject` carrying both versions & both sides' kernel API versions; page renders "Switchboard was updated — reload this tab"; `switchboard.status` reports `lastHandshakeRejection` to agents |
| Snapshot announce → bridge diff → tools per connected agent (`McpServer`-per-session over one registry) | ✅ Page announces 4 commands in one snapshot → **one** debounced registry change → each session notified once (no storm). Two concurrent SDK clients see identical 7-tool lists. Page **reload** re-announces an identical snapshot → diff suppresses notification → **zero agent-visible churn** |
| Invoke round-trip incl. `isError` and cancel → `AbortSignal` | ✅ `demo.echo` returns schema-conforming `structuredContent`; `demo.bad-output` (violates own `outputSchema`) → `isError` naming the command; `demo.throws` → `isError` with handler message; calling a page command with no page → actionable `isError` ("open http://localhost:5173"), never protocol "unknown tool". Agent-side abort at 750 ms → wire `cancel` → page `AbortController` fired → `demo.aborted` event observed via `switchboard.events.tail` |
| `switchboard.status` with and without a page | ✅ Without: `connected: false` + actionable hint, tool list = exactly the 3 built-ins, `events.tail` still serves its buffer. With: tab list w/ stable tab ids, active tab, kernel API version (diagnostics), registry & buffer counts, agent session count |

Bonus evidence beyond the checklist:

- **Grace period (decision 12):** tab close → 3 s grace → "page commands leave the tool list" → list truthfully shrinks to built-ins; reload reconnects well inside the grace window with no churn.
- **Multi-tab / active-tab (decision 11):** two Chrome tabs connected with distinct stable tab ids; window-focus notifications flipped the active tab; a background tab's channel drop failed over to the remaining tab with the registry intact.
- **Reconnection (decision 14):** dev-server restart force-reloaded the page (Vite ping behavior), which reconnected with a fresh handshake + fresh snapshot — no resync protocol needed. Tail ring buffer survived page reloads and enforced its 100-event cap.
- **Live context read (decision 8):** `switchboard.context.read demo.counter` returned the human's click-driven state (13) as a fresh round-trip — no cache.
- **Attribution (decision 7):** every announced tool carries `_meta["switchboard/pluginId"]`; annotations pass through verbatim.

## Implementation findings (refinements, not overturns)

1. **Page-side invoke dispatch must be detached from the channel listener.** Vite's HMR client processes incoming WS messages **sequentially** — `await`-ing a long-running command handler inside the `hot.on` listener blocked the entire wire pump, so the `cancel` for a 30 s command was only delivered *after* the command finished (observed: cancel sent at t+0, received at t+30 s). Fix: execute invokes fire-and-forget (`void (async () => …)()`), keeping the listener synchronous. This belongs in the **adapter contract / page-kernel spec** as a normative note: the wire pump must never be blocked by command execution.
2. **MCP sessions leak without server-side GC.** 2025-era clients are *not required* to `DELETE` their session; closing an SDK client without `terminateSession()` leaves the server-side transport (and its `McpServer` + registry listener) alive indefinitely — 6 sessions accumulated across three validator runs. `bridge-mcp` needs an idle-session reaper (last-activity timestamp + sweep). Well-behaved DELETE works and cleans up fully.
3. **Use the SDK's low-level `Server`, not `McpServer`, at the bridge edge.** `McpServer.registerTool` is Zod-shaped; the page hands the bridge plain JSON Schema. The low-level `Server`'s `tools/list` handler returns the page's schemas **verbatim** and rebuilds the list from the canonical registry on every call — which also collapses the research's per-instance `RegisteredTool` mirroring into "one `sendToolListChanged()` per session per debounced registry change". Simpler than charted, same observable behavior.
4. **Localhost binding is IPv6-literal.** Vite with `host: 'localhost'` bound `[::1]:5173` only on this machine — `127.0.0.1` connections are refused outright (a free extra door-lock, but agent configs must use `localhost`, not `127.0.0.1`). Worth one line in the adapter docs.

Also confirmed empirically (was an assumption in decision 13): the SDK's `enableDnsRebindingProtection` + `allowedOrigins` **accepts requests with no Origin header**, so terminal agents connect with zero config while browser-origin attacks are refused.

## Decision-by-decision status

Decisions 1–14 of #11: **all validated or exercised**; none contradicted. Not exercised (out of spike scope, nothing observed against them): per-command timeout override absence (10, additive later), the reserved `auth` handshake field (6/13 — carried in the wire type, ignored as specified), `switchboard.events.tail`/`context.read` under a *rejected*-page-only condition (12 — covered by the no-page case).

## Running it

```
cd spikes/mcp-bridge-transport
pnpm install
pnpm dev                      # Vite + bridge on http://localhost:5173
pnpm validate:no-page         # before opening the page
pnpm validate:origin
# open http://localhost:5173 (and optionally ?v=999 for the rejection path)
pnpm validate:with-page
pnpm exec tsx scripts/validate.mts watch   # 45s list_changed watcher; reload/close the tab meanwhile
pnpm exec tsx scripts/status.mts           # one-shot switchboard.status
```

Spike code layout: `src/wire.ts` (envelope + versions), `src/bridge/core.ts` (channel-agnostic bridge), `src/bridge/mcp-session.ts` (per-session MCP surface + built-ins + Ajv `outputSchema` gate), `src/bridge/vite-plugin.ts` (Streamable HTTP mount + HMR-channel adapter), `src/page/kernel-stub.ts` (page registry stub). De-risking evidence, not shipping code.
