# Hosting the bridge in `adapter-next`: where the two doors mount

> Research for the `adapter-next` hosting question raised as open question 2 of [mcp-live-page-transport.md](./mcp-live-page-transport.md) (§5.6). Researched 2026-08-05 against primary sources via three parallel sub-investigations (Next.js surfaces, prior art, transport constraints).
>
> **Versions checked:** Next.js **16.3.0** (current stable, released 2026-08-03; Turbopack default for dev *and* build since 16.0); `@modelcontextprotocol/sdk` 1.30.0; Chrome Local Network Access as enforced since Chrome 142 (2025-10-28).
>
> Claims tagged: **[docs]** = official docs, **[src]** = verified in project source, **[spec]** = normative spec text, **[sec]** = secondary/community source, **[spike]** = this repo's `spikes/mcp-bridge-transport/FINDINGS.md`.

---

## TL;DR + recommendation

**Both doors mount on one in-process "bridge port": a small HTTP+WebSocket server that `adapter-next` starts from `instrumentation.ts` `register()`, inside the Next.js dev-server process, bound to loopback on its own fixed, configurable port.**

```
agent (Claude Code / Cursor / …)
   │  MCP Streamable HTTP  —  http://localhost:<bridgePort>/mcp
   ▼
bridge (IN the `next dev` server process — started by instrumentation.ts register();
   │    same BridgeCore, same session map, same code as the Vite spike)
   │  Switchboard wire protocol over a plain WebSocket
   │  ws://localhost:<bridgePort>/ws   (page dials out, cross-port, loopback→loopback)
   ▼
page kernel (app served from http://localhost:3000 by next dev)
```

Load-bearing reasons:

1. **It is the only mount that is simultaneously supported, single-file, and WebSocket-capable.** Next.js exposes no `configureServer` equivalent and no supported way to reach the dev HTTP server instance from user code ([#58698](https://github.com/vercel/next.js/discussions/58698)) [src]; route handlers cannot accept upgrades (RFC [#95514](https://github.com/vercel/next.js/discussions/95514) is still a draft); a custom server is standalone-incompatible and heavyweight (§2.1). A side port dodges all of that, and `instrumentation.ts` — stable since Next 15, Turbopack-supported — is a genuine dev-server lifecycle hook that runs in the right process (§1.2).
2. **The process model makes "in-process side port" trivial.** Since the Turbopack era, `next dev` is one CLI parent + **one forked server child**; router, render server, bundler, route handlers, and nodejs-runtime instrumentation all execute in that same child, which also owns the listening socket ([router-server.ts](https://github.com/vercel/next.js/blob/v16.3.0/packages/next/src/server/lib/router-server.ts) L244-245, [next-dev.ts](https://github.com/vercel/next.js/blob/v16.3.0/packages/next/src/cli/next-dev.ts)) [src]. One `BridgeCore` on `globalThis`, both doors in the same event loop — exactly the spike's topology, no IPC.
3. **Chrome's Local Network Access explicitly exempts loopback→loopback**, WebSockets included: "`loopback` → anything is not a local network request" ([LNA explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md), [Chrome blog](https://developer.chrome.com/blog/local-network-access)) [spec][docs]. The historical objection to the side-port pattern (cross-origin blocks/prompts) is dead for this topology. Sentry Spotlight ships exactly this architecture (page → sidecar on `localhost:8969`, HTTP in / SSE out) with no LNA trouble in current Chrome ([architecture docs](https://spotlightjs.com/docs/architecture/)) [docs].
4. **The page leg stays a real WebSocket**, so the wire protocol's requirements (ordered, bidirectional, low-latency; cancel must overtake a running invoke) are met by the transport instead of being reimplemented on top of SSE+POST (§4). The bridge-edge code from the transport spike — Node `StreamableHTTPServerTransport`, low-level `Server` per session, Ajv gate, session GC — transfers **verbatim**, because the side port hands us raw Node `req`/`res` just like Vite's middleware did [spike].
5. **A fixed bridge port is *more* stable than the app port for agent configs.** `next dev` silently increments to 3001 when 3000 is busy [sec], which would break a configured MCP URL riding the app origin; Next 16's project lockfile ("one `next dev` per project") makes a per-project fixed bridge port safe ([Next 16 blog](https://nextjs.org/blog/next-16)) [docs].

App-developer surface (the whole integration):

```ts
// instrumentation.ts  (or one line inside an existing register())
export { register } from '@switchboard/adapter-next'
```

plus the framework-agnostic client provider the app already has, pointed at the bridge port (default baked in, overridable).

---

## 1. The Next.js 16 dev-server surface, as verified

Facts the ruling depends on; all verified 2026-08-05.

### 1.1 Process model & restarts

- `next dev` = CLI parent + **one forked server child** running `start-server.ts` → `router-server.ts`; the old jest-worker render-worker split is gone — the render server is `require`d in-process ([router-server.ts](https://github.com/vercel/next.js/blob/v16.3.0/packages/next/src/server/lib/router-server.ts) L244-245) [src]. Bundler choice (Turbopack default, `--webpack` opt-out) does not change the topology [src].
- Module state in an edited `route.ts` resets on Fast Refresh, but **`globalThis` persists across HMR** (same process) — the canonical dev-singleton pattern works [src][sec].
- The **whole child is killed and re-forked** on: `next.config.*` edits, crashes, and — new and default-on in 16.3 — the `experimental.devMemoryThresholdRestart` memory-pressure self-restart ([start-server.ts](https://github.com/vercel/next.js/blob/v16.3.0/packages/next/src/server/lib/start-server.ts)) [src]. **Any in-process mount must treat sudden whole-process death as routine** (§6).

### 1.2 `instrumentation.ts` semantics

- `register()` "is called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests"; it runs in **all runtimes**, so nodejs-only code must guard on `process.env.NEXT_RUNTIME === 'nodejs'` ([instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation), [reference](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)) [docs]. Stable since v15.0.0; Turbopack support since v14.0.4 [docs].
- It runs at dev-server startup, in the child process that owns the socket (§1.1) [src] ([#59999](https://github.com/vercel/next.js/issues/59999) was about *prod* lazy-calling, fixed). It is **not** re-run on route-file HMR; it *is* re-run when the child is re-forked (§1.1). Historic "called 3 times" reports ([#51450](https://github.com/vercel/next.js/issues/51450)) date from the pre-14 multi-worker model, but the multi-runtime pass and re-forks mean idempotency guards are still mandatory [sec].
- Community precedent for starting socket servers from `register()` exists (the well-known workaround in [#58698](https://github.com/vercel/next.js/discussions/58698)); documented pitfalls are exactly the guards above plus `EADDRINUSE` on fast re-forks [sec].

### 1.3 Upgrade handling in `next dev`

- The dev server attaches one upgrade handler. Flow ([router-server.ts](https://github.com/vercel/next.js/blob/v16.3.0/packages/next/src/server/lib/router-server.ts) ~L908-1013) [src]:
  1. dev-only `blockCrossSiteDEV` check against `allowedDevOrigins`;
  2. HMR path → hot reloader. The HMR WS path is `/_next/webpack-hmr` through 16.2 **including under Turbopack**, renamed **`/_next/hmr` in 16.3.0** [src];
  3. URL matches a filesystem route → `socket.end()`;
  4. rewrite to an external destination → the upgrade is **proxied** (`proxyRequest`) — i.e. `rewrites` can carry WebSocket upgrades to another local server [src];
  5. no match → Next does **nothing**, verbatim comment: *"we don't handle the request as user's custom WS server may be listening on the same path."* [src]
- There is **no supported hook exposing the dev HTTP server instance** to user code — no `experimental` flag, nothing in `onDemandEntries` [src][docs]. Same-port WS therefore requires either a custom server or patching internals.
- **RFC [#95514](https://github.com/vercel/next.js/discussions/95514)** ("WebSocket Upgrades in Route Handlers", `NextResponse.upgrade()`, maintainer-authored 2026-07-06, explicitly covering `next dev`) is **Draft, unshipped as of 16.3** [sec]. Watch item, not a foundation.

### 1.4 Route handlers, streaming, and dev compression

- Node-runtime route handlers serve long-lived SSE in dev; `request.signal` aborts on client disconnect (`signalFromNodeResponse`, [next-request.ts](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/web/spec-extension/adapters/next-request.ts)) [src].
- Dev applies the `compression` middleware whenever `config.compress !== false` (no dev/prod distinction in `router-server.ts`) [src] — but Next calls `res.flush()` after **every** chunk it pipes ([pipe-readable.ts](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/pipe-readable.ts)) [src], so route-handler SSE frames are not held in the gzip buffer on current Next. (Older buffering reports like [#62201](https://github.com/vercel/next.js/issues/62201) [sec] predate this path; belt-and-braces headers remain cheap insurance — §4.) 16.3 even added zlib-stream cleanup for SSE clients that vanish mid-stream [src].
- **First-party validation of "MCP inside the dev server":** Next 16 ships a built-in dev-only MCP endpoint at **`/_next/mcp`** ([MCP guide](https://nextjs.org/docs/app/guides/mcp)) [docs], and Vercel's [`mcp-handler`](https://github.com/vercel/mcp-handler) mounts MCP on a route handler — but v2.x is **deliberately stateless** (no `Mcp-Session-Id`, no GET SSE notification stream; the 1.x SSE path needed Redis pub/sub) [docs][src]. Useful precedent for the *mount*, not reusable for a *stateful* bridge.

### 1.5 `proxy.ts` / middleware

Since 16.0 the file is `proxy.ts` (Node runtime; `middleware.ts` deprecated, Edge) [docs]. It is a per-request, before-routing boundary with no upgrade surface and no sanctioned long-lived-response mechanism (`waitUntil` extends background work, not client streams) ([proxy reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)) [docs]. Ruled out for both doors without further analysis.

---

## 2. Candidate mounts

### 2.1 Custom server (`next({ dev: true })` + own `http.Server`)

```ts
// server.mjs — what every app using Switchboard would have to adopt
const app = next({ dev, httpServer: server })
// Next self-attaches its upgrade handler (HMR keeps working);
// our own 'upgrade' listener claims /__switchboard/ws — safe per §1.3(5).
server.on('upgrade', (req, socket, head) => { if (isBridgePath(req)) wss.handleUpgrade(...) })
```

Technically everything fits: same-origin WS and MCP on the app port, raw Node `req`/`res`, Turbopack supported under custom servers (enabled by default in the `next()` options) [docs]. Next even auto-attaches its own upgrade handling to your server (`setupWebSocketHandler` in [next.ts](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/next.ts)) [src], and `app.getUpgradeHandler()` exists for explicit forwarding [src].

**Killed by cost, not capability:** the docs' headline caveat — standalone output "cannot be used together" with a custom server, and `server.js` bypasses the Next compiler ([custom-server guide](https://nextjs.org/docs/app/guides/custom-server)) [docs]. Demanding that an app **eject its entire dev/start entrypoint to install a devtool** fails the one-line-integration bar categorically, breaks `next start`/deploy parity for teams using standalone, and puts Switchboard on the hook for every custom-server interaction bug. Documented as a *compatibility note* (apps that already run a custom server can hook the same bridge in), never the required mount.

### 2.2 Route handler — MCP door: viable; page door (SSE+POST): honest but inferior

```ts
// app/__switchboard/mcp/route.ts — MCP door variant (works today)
export { GET, POST, DELETE } from '@switchboard/adapter-next/mcp-route'
export const dynamic = 'force-dynamic'
```

The **MCP door** genuinely fits a route handler: Streamable HTTP is plain POST + long-lived GET SSE + DELETE; dev streams flush per-chunk (§1.4); `request.signal` gives disconnect detection; session map + `BridgeCore` live on `globalThis`. This is the Vercel-validated pattern (`mcp-handler`, `/_next/mcp`). Two real costs: (a) it needs the SDK's `WebStandardStreamableHTTPServerTransport` (web `Request`/`Response`) instead of the Node transport the spike validated — a second code path vs `adapter-vite`; (b) it rides the app origin, whose port drifts when 3000 is busy [sec], breaking configured agent URLs.

The **page door** on route handlers means SSE (bridge→page) + POST (page→bridge). Verdict in §4: workable, not chosen.

**Ruling:** not selected for v1 (two mounts, two files, port drift, transport-code divergence) — but this is the natural door shape for a **future production adapter**, so `bridge-mcp`'s HTTP handling should stay expressible over web-standard `Request`/`Response` too (§6).

### 2.3 In-process side port from `instrumentation.ts` — **recommended**

```ts
// @switchboard/adapter-next — sketch
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return   // register() runs once per runtime [docs]
  if (process.env.NODE_ENV !== 'development') return  // dev-only in v1
  const g = globalThis as Record<string, unknown>
  if (g.__switchboard) return                          // idempotency across re-registration
  const { startBridge } = await import('./server.js')  // keep node deps out of the edge pass
  g.__switchboard = await startBridge({
    port: Number(process.env.SWITCHBOARD_PORT ?? DEFAULT_BRIDGE_PORT),
    // two listeners, one BridgeCore: 127.0.0.1 AND ::1 (§6, spike finding 4)
    // routes: POST/GET/DELETE /mcp  → spike's handleMcp, verbatim
    //         GET /ws (upgrade)     → ws.WebSocketServer({ noServer: true }), Origin-gated
    // EADDRINUSE → bounded retry (old socket lingers across child re-forks), then loud error
  })
}
```

Everything from §1 lines up behind this: right process (§1.1), right lifecycle hook (§1.2), no Next internals touched, no interaction with Next's own upgrade handling at all. The page leg is a real WS; the agent leg reuses the spike's Node-transport code untouched. `output: 'standalone'` is unaffected (the whole thing no-ops outside dev). Turbopack vs webpack: irrelevant — nothing bundler-facing. Windows/IPv6: solved by construction (bind both loopback literals; the browser's `localhost` resolution can't miss) — strictly better than the Vite spike's accidental `[::1]`-only bind [spike].

Costs, honestly: a second localhost port (mitigated: fixed + configurable, loopback-only, LNA-exempt §3); Origin allowlist + a small CORS answer are Switchboard's own code (already mandated by auth v1 at both doors, so not incremental); the client channel must reimplement what Vite's HMR channel gave free — connect buffering, reconnect with backoff, disconnect signaling (§6); remote/containerized dev needs the port forwarded (open question 3).

### 2.4 Spawned sidecar process + rewrites (the Vercel Toolbar pattern)

Vercel Toolbar's Next plugin spawns a sidecar on a free port from `next.config` and injects a rewrite — `/.well-known/vercel-toolbar/:path*` → `http://127.0.0.1:<port>/:path*` — so the browser sees same-origin ([plugin source on unpkg](https://unpkg.com/@vercel/toolbar@latest/dist/plugins/next.js)) [src]. Sentry Spotlight is the un-proxied cousin: independent process, port 8969, origin-allowlisted with DNS-rebinding defense ([sidecar docs](https://spotlightjs.com/docs/sidecar/), [cors.ts](https://github.com/getsentry/spotlight/blob/main/packages/spotlight/src/server/utils/cors.ts)) [docs][src].

**Ruling: out for v1.** A separate *process* would put the registry on the far side of an IPC boundary from any in-app code, adds spawn/orphan lifecycle management (`next.config` evaluates in multiple processes and on every config reload), and buys only one thing over §2.3 — surviving the dev child's restarts — which the reconnect design already absorbs (§6). The **rewrite trick, however, is worth keeping**: rewrites to external destinations proxy WebSocket upgrades in dev (§1.3(4)) [src], so a same-origin `/__switchboard/*` façade over the §2.3 side port is a plausible escape hatch for tunneled dev (Codespaces) without changing the mount (open question 3).

### 2.5 Same-port WS via internals: `next-ws` patching / `req.socket.server` hacks

`next-ws` edits `node_modules/next/dist` files at install time (injects a WS server into `NextNodeServer`, voids the router-server's socket-destroys), supports `>=15.0.0 <=16.3.0` by explicit pin, and has open Turbopack type-validation breakage ([patch source](https://github.com/k0d13/next-ws/blob/main/src/patches/patch-2.ts), [repo](https://github.com/k0d13/next-ws)) [src]. The lazier variant — fishing the live `http.Server` out of a request's `req.socket.server` or process internals — is equally unsupported. **Ruled out: version-pinned patching of a bundler-era Next.js is exactly the maintenance treadmill an adapter contract exists to avoid.**

### 2.6 `proxy.ts` / middleware

Ruled out per §1.5: per-request boundary, no upgrade API, no long-lived streams, and its job description (CDN-deployable request filter) is hostile to holding bridge state.

---

## 3. Why the side port is safe in 2026 browsers

The classic objections to "page on :3000 dials :4114" were checked against current reality:

- **Chrome LNA (enforced since 142):** address spaces are loopback / local / public; gated directions are public→local, public→loopback, local→loopback. *"`loopback` → anything is not a local network request"* — no prompt, no preflight, WebSockets included via Fetch integration ([explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md), [Chrome blog](https://developer.chrome.com/blog/local-network-access)) [spec][docs]. All reported LNA breakage involves public/LAN-origin pages, not loopback→loopback [sec].
- **Safari 18+ / macOS:** local-network privacy is an OS-level packet filter aimed at LAN/Bonjour traffic; loopback is same-device and unaffected ([Apple support](https://support.apple.com/en-us/121011)) [docs]; reported blocks concern LAN-IP targets [sec].
- **WebSocket has no CORS**: RFC 6455 §4.1 requires browsers to send `Origin` on the handshake; the server MAY reject — meaning the bridge **must** enforce its allowlist itself or any website can connect (Cross-Site WebSocket Hijacking) ([RFC 6455](https://www.rfc-editor.org/rfc/rfc6455)) [spec]. This is auth v1 anyway; Spotlight's open hardening issue ([#1137](https://github.com/getsentry/spotlight/issues/1137)) is the cautionary tale [src].
- **No-Origin agents:** unchanged from the spike — the MCP door's Origin check accepts absent-Origin requests (terminal clients) while refusing disallowed browser origins; empirically confirmed with the SDK's `enableDnsRebindingProtection` + `allowedOrigins` [spike].
- **CORS on any HTTP leg** (only needed if a page ever POSTs to the bridge port): one preflight per max-age window against a static allowlist — trivial [spec].

---

## 4. SSE+POST as the page leg: the honest verdict

Not needed under the recommendation — the side port gives a real WebSocket. Assessed anyway, because it is the only same-origin fallback if a side port were ever untenable:

| Requirement | SSE (bridge→page) + POST (page→bridge) |
|---|---|
| Ordered downstream | ✅ within one SSE connection ([WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html)) [spec] |
| Ordered upstream | ❌ not natively — parallel fetches have no cross-request ordering; needs a hand-rolled single-in-flight promise queue + sequence numbers [spec][sec] |
| Reconnect | ⚠️ `EventSource` auto-reconnects and sends `Last-Event-ID` only if the server stamped `id:`s; anything sent during the gap is **lost unless the bridge keeps a replay buffer**. A lost `cancel` means a runaway command; a lost `invoke` burns its 60s timeout [spec] |
| Dev-server interference | ⚠️ dev compression applies (§1.4) but Next flushes per chunk [src]; still send `Cache-Control: no-cache, no-transform` (+ `X-Accel-Buffering: no` for proxied setups) as insurance [docs] |
| Connection budget | ❌ the real hazard: HTTP/1.1 caps ~6 connections **per origin across all tabs**, each SSE stream holds one, and `next dev` cannot speak h2 even under `--experimental-https` ([MDN warning](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [discussion #85001](https://github.com/vercel/next.js/discussions/85001)) [docs][src]. Multi-tab dev (a first-class Switchboard scenario) + an app that streams competes for the same pool |
| Latency | ✅ fine on loopback |

**Verdict: functional with added machinery, and honestly meets "ordered, bidirectional" only after reimplementing ordering, replay, and reconnect that a WebSocket provides natively — while introducing a multi-tab connection-pool hazard the WS doesn't have.** Keep as a documented fallback design, unbuilt in v1.

## 5. Ruling table

| Candidate | MCP door | Page door | Killing / deciding constraint | Status |
|---|---|---|---|---|
| **In-process side port via `instrumentation.ts`** (§2.3) | ✅ | ✅ WS | Only supported single-file mount with a real WS; same process as app code; LNA-exempt | **Chosen — both doors** |
| Route handler (§2.2) | ✅ | ⚠️ SSE+POST only | Page leg per §4; app-port drift breaks agent URLs; second transport code path | Not chosen for v1; earmarked as the production-adapter door shape |
| Custom server (§2.1) | ✅ | ✅ | `output: 'standalone'` incompatibility + forces app-entrypoint ejection — fails drop-in bar | Ruled out as required mount; compat hook documented |
| Spawned sidecar process + rewrites (§2.4) | ✅ | ✅ | Registry crosses a process boundary (IPC) + spawn/orphan lifecycle from multiply-evaluated `next.config` | Ruled out for v1; rewrite façade retained as tunneled-dev escape hatch |
| `next-ws` patching / server-instance hacks (§2.5) | – | ✅ | Version-pinned patching of `node_modules/next` internals; Turbopack breakage | Ruled out |
| `proxy.ts` / middleware (§2.6) | ❌ | ❌ | Per-request boundary; no upgrade surface; no long-lived streams | Ruled out |
| `NextResponse.upgrade()` (RFC #95514) | – | ✅ (future) | Draft, unshipped as of 16.3 | Watch item — would let the page door move same-origin and retire the side port |

## 6. Notes toward the adapter contract spec

What `adapter-next` must expose / require of the app, and how the four spike findings [spike] carry over:

1. **App integration surface (v1):** exactly one server-side line — `export { register } from '@switchboard/adapter-next'` in `instrumentation.ts` (or a call inside an existing `register()`), plus the client provider configured with the bridge URL (default `ws://localhost:<DEFAULT_BRIDGE_PORT>/ws`, overridable via `SWITCHBOARD_PORT` / a `NEXT_PUBLIC_` mirror for the page side). No `next.config.ts` changes required in the default path.
2. **Mandatory guards in `register()`:** `NEXT_RUNTIME === 'nodejs'` (multi-runtime passes), `NODE_ENV === 'development'` (also keeps `next build`'s instrumentation load inert), `globalThis` idempotency flag, and bounded `EADDRINUSE` retry with a loud, actionable failure (config-edit and memory-threshold re-forks can race the old socket's release — §1.1).
3. **Restart tolerance is part of the contract.** Next 16.3 restarts the dev child on config edits *and* on memory pressure by default (§1.1) — both doors die together, which is at least consistent. The page channel client **must** implement reconnect-with-backoff + pre-connect send buffering + disconnect signaling (the Vite adapter got all three from `import.meta.hot`; here they are adapter code). Snapshot sync already makes reconnect cheap: fresh handshake + full snapshot, bridge diffs, zero agent-visible churn on identity [spike]. MCP agents re-initialize per their era's rules; the registry is rebuilt from the page's snapshot, so no bridge-side persistence is needed.
4. **Spike findings mapping:** (1) detached page-side dispatch is channel-independent — it becomes a normative page-kernel rule: the WS `onmessage` handler must never `await` command execution; (2) the idle-MCP-session reaper ships in the side-port server unchanged, plus WS-close-driven page cleanup; (3) the low-level `Server`-per-session bridge edge and the Node `StreamableHTTPServerTransport` transfer verbatim because the side port speaks raw Node `req`/`res`; (4) the IPv6-literal trap is closed by binding **both** `127.0.0.1` and `::1` explicitly (Node ≥17 resolves `localhost` in OS order, sometimes `::1`-only — [nodejs#56137](https://github.com/nodejs/node/issues/56137)) [src]; agent docs may say `localhost` freely.
5. **Auth v1 at both doors, one policy object:** WS handshake rejects disallowed `Origin` (browsers always send it — RFC 6455) and the MCP door keeps the spike's allowlist-with-no-Origin-admissible behavior. Default allowlist: any loopback origin (`localhost` / `127.0.0.1` / `[::1]`, any port — the app port is not reliably knowable from `register()` and drifts anyway); strict origin pinning stays configurable. Rebinding attacks arrive with non-loopback `Origin`s, which the default still refuses.
6. **Keep `bridge-mcp`'s HTTP edge dual-expressible** (Node `req`/`res` *and* web-standard `Request`/`Response`): the dev mount uses the Node form; the future production adapter almost certainly mounts as a route handler (§2.2) — `mcp-handler` and `/_next/mcp` establish that as the ecosystem-native shape, and RFC #95514 would extend the same file to the page door. Nothing else in the recommendation constrains a production adapter: the side port is a dev-only artifact.
7. **Port policy:** one fixed default port for the project (safe under Next 16's dev lockfile), env-overridable; document that two *different* Switchboard projects running simultaneously must set distinct ports (the `EADDRINUSE` message should say exactly this).

## 7. Open questions

1. **Default bridge port number** — pick once, before the contract spec freezes; must be outside common dev defaults (3000/3001, 5173, 6006, 8969, 5555) and registered in the adapter docs.
2. **`NextResponse.upgrade()` adoption trigger** — if RFC #95514 ships (even experimental), does `adapter-next` add a same-origin page-door mode, and does the side port remain the default until the feature reaches stable? Re-evaluate on the RFC's first shipped release.
3. **Tunneled/remote dev (Codespaces, devcontainers)** — the side port needs explicit forwarding there; the rewrite façade (§2.4 — dev rewrites proxy WS upgrades per §1.3(4)) could restore a same-origin page leg with zero client config. Needs a small validation spike before promising it.
4. **`next build` instrumentation behavior** — the `NODE_ENV` guard should keep the bridge inert during builds, but this was reasoned, not exercised; confirm during adapter implementation that `next build` (Turbopack and `--webpack`) never starts the listener.
