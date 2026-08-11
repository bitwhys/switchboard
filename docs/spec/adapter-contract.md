# Switchboard Adapter Contract

**No separate version.** This contract has no version number of its own: nothing at runtime negotiates "which adapter contract do you implement?" Every wire-visible obligation below cites the [bridge protocol](./bridge-protocol.md), whose integer version is the one gate that exists ([bridge §2](./bridge-protocol.md#2-versioning-the-handshake-gate)); the rest versions with the spec suite. If a future breaking change to this contract ever needs runtime gating, that is the moment to add a number — additively, like the reserved `auth` field ([bridge §15.4](./bridge-protocol.md#154-the-reserved-auth-field)).

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119.

TypeScript signatures and typed-JSON shape blocks in this document are **normative**. Prose qualifies them; it does not override them.

An **adapter** is the package that hosts the bridge inside a development server and connects a page kernel to it — `@switchboard-dev/adapter-vite`, `@switchboard-dev/adapter-next`, or a third-party equivalent for another host. This document is the normative home for the obligations any adapter must meet on **both doors** — the agent-facing MCP edge and the page channel — plus the binding commitments of the two shipped adapters. §§2–9 bind every adapter equally, shipped or third-party; §10 and §11 bind the named packages. Related documents: [`bridge-protocol.md`](./bridge-protocol.md), [`kernel-api.md`](./kernel-api.md), [`diagnostics.md`](./diagnostics.md).

*Consolidates (non-normative): the resolution of ticket #43; §6 of the [adapter-next hosting research](../research/adapter-next-hosting.md); §§6–8 of the [bridge default-port research](../research/bridge-default-port.md) (#40); the channel-handle interface and ownership split of #38; the host-integration patterns of #44; the `port-in-use` interpretation of #73.*

---

## 1. Scope: what an adapter owns

### 1.1 The split

The page half of the wire protocol — handshake, snapshot building, grant filtering, the wire pump, invoke/cancel/context/event handling, wire-legality — is implemented **once**, by the wire client that ships as the browser-only subpath export of `@switchboard-dev/bridge-mcp`. An adapter MUST inject that wire client rather than reimplement any part of it: the protocol is MUST-heavy, and per-adapter copies were explicitly rejected (#38).

What remains is the adapter's, and it is exactly this contract:

- **mounting the node-side bridge** in the dev-server process (§2, §6);
- **providing and securing the page channel** (§3, §4);
- **delivering the page bootstrap** so the app writes zero bridge code (§8);
- **configuration** (§5, §9) and **lifecycle** (§7).

### 1.2 Development only

v1 adapters are development tools. An adapter MUST be **inert outside development**: no listener, no injected bootstrap, no bridge code in production bundles (§7.1). The production posture arrives later through the reserved `auth` field ([bridge §15.4](./bridge-protocol.md#154-the-reserved-auth-field)), not by running a v1 adapter in production.

## 2. Topology: the two doors

One bridge — one registry, one session map — per dev-server process ([bridge §1](./bridge-protocol.md#1-scope-and-topology)).

### 2.1 The MCP door lives on the bridge port

The agent-facing MCP endpoint MUST be served at

```
http://localhost:<bridge port>/mcp
```

on the **dedicated bridge port** (§6) — never on the application's own port. The agent's URL is a hand-written literal in an MCP client config, and app ports drift (`next dev` silently increments off 3000, Vite off 5173): an MCP door riding the app port breaks every configured agent the first time the port moves. One fixed door means one documented `.mcp.json` snippet for every Switchboard project, regardless of framework.

### 2.2 The page channel is the adapter's choice

The page channel is whatever the adapter can best provide in its host — an existing dev-server socket, a WebSocket on the bridge port, an in-process pair in tests — so long as it meets [bridge §4.2](./bridge-protocol.md#42-channel-requirements) (ordered, reliable, bidirectional, disconnect-signaling) and the obligations of §3 and §4 below. The shipped choices: adapter-vite rides Vite's HMR WebSocket (§10.2); adapter-next mounts `/ws` on the bridge port (§11.3).

### 2.3 Binding

The bridge port MUST bind loopback only, and SHOULD bind **both** loopback literals (`127.0.0.1` and `::1`) per [bridge §15.1](./bridge-protocol.md#151-binding); the `::1` bind is best-effort on IPv6-less hosts. Documentation tells agents to dial `localhost`.

## 3. The page channel

### 3.1 Connection handles

The adapter hands the wire client the channel as **single-use connection handles**:

```ts
interface WireConnection {
  send(message: object): void                       // parsed JSON objects, not strings
  onMessage(cb: (message: object) => void): () => void
  onClose(cb: () => void): () => void
}
```

One handle is **one channel lifetime**. The adapter MUST hand over a fresh handle for every established connection and MUST NOT reuse a handle across connections. The wire client opens every handle with `hello` → snapshot, which makes fresh-handshake-per-connection ([bridge §14.3](./bridge-protocol.md#143-reconnection)) structural: nothing can buffer across connections, so hello-first cannot be violated by interface shape.

### 3.2 Open-only handover

A handle MUST NOT be handed to the wire client before the underlying channel actually delivers messages, in order, in both directions. There is no pre-connect send buffering in this interface: a handle is live by definition, and `send` on a live handle never queues into the void. Whatever buffering a host channel performs during its own establishment (Vite's `hot.send` buffers until connected) is adapter-internal plumbing the wire client never sees — the adapter simply waits for the channel's connected signal before handing over.

### 3.3 Disconnect signaling

`onClose` MUST fire promptly when the channel is lost, whatever the cause — socket close, dev-server death, page navigation. After `onClose` fires the handle is spent: subsequent `send` calls MUST be discarded (not queued, not thrown).

### 3.4 Reconnection

After a channel loss, while the page lives, the adapter (or its page-side bootstrap):

- MUST re-establish the channel automatically — no user action, no page reload requirement of its own;
- MUST keep retrying indefinitely — dev servers come back, and a bridge that gave up is indistinguishable from a broken one;
- MUST back off between attempts enough not to busy-spin the tab.

The retry curve is deliberately non-normative; RECOMMENDED: exponential from ~500 ms, capped at ~5 s. On success the adapter hands a fresh handle; the wire client's fresh `hello` → snapshot and the bridge's diff ([bridge §6.1](./bridge-protocol.md#61-snapshots-not-deltas), [§14.2](./bridge-protocol.md#142-the-grace-period)) make a quick recovery agent-invisible. An adapter riding a channel with native reconnection complies by construction; sudden whole-process death of the dev server is routine, not exceptional ([bridge §14.3](./bridge-protocol.md#143-reconnection)).

### 3.5 Serialization is the adapter's

Handles speak parsed JSON objects on both sides. The adapter owns (de)serialization for its channel; unparseable channel input is the adapter's own [malformed-message](./diagnostics.md#52-bridge-codes) report per [bridge §4.3](./bridge-protocol.md#43-tolerance-posture).

## 4. Security

The threat model is [bridge §15](./bridge-protocol.md#15-security-posture-auth-v1)'s: the malicious website versus the localhost dev server. Nothing here defends against local processes.

### 4.1 The page-door obligation

Per [bridge §15.3](./bridge-protocol.md#153-page-door-channel-security), the page channel MUST be protected by **either**:

- **(a)** riding a channel with its own handshake protection — Vite's post-CVE token handshake qualifies; **or**
- **(b)** enforcing an Origin allowlist or token check itself on the handshake. Browsers always send `Origin` on WebSocket upgrades (RFC 6455) and never enforce anything — the server must.

### 4.2 The default policy

Where the adapter enforces origins itself (path (b)), the default allowlist MUST be: **any loopback origin** — `localhost`, `127.0.0.1`, `[::1]`, any port, any scheme. The application's own port is not reliably knowable from the adapter's mount point and drifts anyway; a wrongly pinned origin bricks the channel, while loopback-any still refuses every origin a malicious website can present. The MCP door additionally admits absent-Origin requests (terminal agents) per [bridge §15.2](./bridge-protocol.md#152-mcp-door-origin-allowlist).

**One policy object governs both doors** of the bridge port: an origin admitted at one door is admitted at the other. Strict origin pinning MUST be available as configuration (§9); it narrows the default, never widens the refusals.

### 4.3 The shared WS door

`bridge-mcp`'s node side provides the page-door WebSocket implementation — upgrade handling on the bridge port, the Origin gate of §4.2, and wiring accepted sockets into §3.1 handles. adapter-next consumes it (§11.3); third-party adapters that want a WebSocket page door SHOULD reuse it rather than hand-roll security-critical code.

## 5. Timeouts

The bridge bounds every invocation — **default 60 seconds**, no per-command override in v1 ([bridge §7.4](./bridge-protocol.md#74-bridge-timeout)). "Configurable where the application developer configures the adapter" means here: every adapter MUST expose `invokeTimeoutMs` in its options (§9) and pass it through to the bridge. Adapters MAY likewise expose the bridge's other tunables (grace period, tail-buffer size) under the bridge's own option names; their defaults are the bridge spec's.

## 6. The bridge port

### 6.1 Default and fallbacks

The default bridge port is **7654**; the documented fallbacks are **7655** and **7656** (all inside IANA's explicitly-Unassigned 7649–7662 block — evidence in [the port research](../research/bridge-default-port.md)). The fallbacks are for **humans to configure** when running two Switchboard projects at once. They are never tried automatically.

### 6.2 One variable drives both sides

The port is the one knob that lives in two places — the adapter and the agent's MCP client config — so the override mechanism must move both together. `SWITCHBOARD_PORT` is that mechanism. The documented `.mcp.json` snippet is:

```jsonc
{
  "mcpServers": {
    "switchboard": {
      "type": "http",
      "url": "http://localhost:${SWITCHBOARD_PORT:-7654}/mcp"
    }
  }
}
```

Port precedence is therefore **environment > code option > 7654**: `SWITCHBOARD_PORT`, when set, MUST win over a `port` passed in adapter options. This inverts conventional precedence deliberately — the env var is the only channel that also updates what agents dial, so nothing may silently override it on one side only. The code option remains useful as a project-pinned default committed alongside the fallback ports. (adapter-next adds a public mirror for the page side — §11.5.)

### 6.3 `EADDRINUSE`: fail loud, never scan

A bridge that silently binds a different port leaves every configured agent pointing at the old one — "up" and broken, with no error anywhere the developer looks. When the bridge port is taken:

1. **Bounded same-port retry first.** A host that re-forks its dev child (Next does, on config edits and memory pressure) can race the old socket's release. The adapter SHOULD retry the **same** port a few times over a short window (order of one second total). This is not a scan: every attempt is for the configured port.
2. **Probe to diagnose, never to reuse.** The adapter SHOULD identity-probe the holder to sharpen its message (is it another Switchboard bridge, or a stranger?). It MUST NOT attach to a sibling bridge it finds: a bridge is bound to one page kernel, and reusing another project's bridge would serve that project's agents the wrong page.
3. **Then fail loud.** Emit the [`port-in-use`](./diagnostics.md#52-bridge-codes) diagnostic with a message naming all three remedies: another Switchboard project holds the port → set `SWITCHBOARD_PORT` for one of them (fallbacks 7655/7656); a stranger process holds it → name the port so the holder can be found; or pick any other free port.
4. **Never bind a different port.** Under no circumstances does the adapter select another port on its own.
5. **The dev server survives.** The failure MUST NOT take the host dev server down: an app developer who does not care about Switchboard right now must still be able to work. `startBridgeServer` emits the diagnostic and throws; the adapter catches `port-in-use` — specifically, after its bounded retry — refuses to start the bridge, and lets the host continue. The error is not swallowed or downgraded: the stderr diagnostic has already fired at full loudness, and the broken-agent path stays diagnosable (agent can't connect → the terminal says exactly why).

*Erratum carried by this document:* diagnostics §5.2's `port-in-use` row read "the process MUST exit rather than scan" while this contract was forthcoming; the settled obligation is **the bridge MUST refuse to serve rather than scan** — the hosting process lives.

## 7. Lifecycle

### 7.1 Inert outside dev

An adapter MUST start nothing — no listener, no bootstrap injection — unless its host is running a development server. In particular, a production build of the host app (`vite build`, `next build`, either bundler) MUST never start the bridge listener, and production bundles MUST NOT contain the bootstrap or wire client. The app-side dev gates of the [host-integration pattern](./kernel-api.md#18-constructing-the-kernel-createswitchboard) drop the kernel and plugins; the adapter's own inertness drops everything else.

### 7.2 Idempotency

Hosts re-initialize: Next re-forks its dev child and runs multi-runtime instrumentation passes; plugins can be evaluated more than once. An adapter MUST start **at most one** bridge per process (a `globalThis` guard is the canonical mechanism) and MUST tolerate repeated initialization without error or duplicate listeners.

### 7.3 Nothing persists

The bridge requires no persistence for correctness ([bridge §14.4](./bridge-protocol.md#144-what-dies-with-the-server)). An adapter MUST NOT try to preserve bridge state across dev-server restarts; recovery is always fresh handshake + fresh snapshot from a reconnecting page (§3.4).

## 8. The page bootstrap

### 8.1 Zero bridge code in the app

The adapter MUST deliver a **bootstrap** module into the page in dev. The bootstrap subscribes to the [kernel handoff](./kernel-api.md#17-the-kernel-handoff), and when a kernel announces itself, attaches the wire client (over §3 handles) to it. The app writes zero bridge code: install the adapter, call `createSwitchboard()`, connected — order-independent, because the handoff is push/subscribe both ways.

On [retraction](./kernel-api.md#173-retraction) (`dispose()` — the HMR escape) the bootstrap MUST drop the wire connection; a later announce re-attaches. Direct use of the wire client remains an escape hatch for exotic setups, but no supported integration requires it.

### 8.2 Configuration reaches the bootstrap, not the app

The bootstrap learns the bridge port from the adapter (injection or environment — per-adapter mechanics in §10/§11), never from app code. There is no provider, no `connect()`, no port prop anywhere in the app-facing surface.

## 9. Configuration vocabulary

Every adapter that accepts options MUST use these names for these meanings:

| Option | Meaning | Default |
|---|---|---|
| `port` | the bridge port (§6; env wins — §6.2) | `7654` |
| `invokeTimeoutMs` | the bridge invocation timeout (§5) | `60_000` |
| `allowedOrigins` | strict origin pinning: replaces the loopback-any default of §4.2 with an explicit allowlist | loopback-any |

Adapters MAY expose additional host-specific options and the bridge's other tunables under the bridge's own names (`gracePeriodMs`, `tailBufferSize`, `pageUrlHint`). How options are *passed* is per-adapter: plugin options for adapter-vite (§10.5), `createRegister` for adapter-next (§11.2).

## 10. `@switchboard-dev/adapter-vite` (normative binding)

### 10.1 Shape

A Vite plugin: `switchboard(options?)`. The plugin declares `apply: 'serve'`, making build-inertness (§7.1) structural — the plugin does not exist during `vite build`.

### 10.2 Page channel: the HMR WebSocket

The page channel rides Vite's own HMR WebSocket with `switchboard:`-prefixed typed events — server side via `server.ws` (or `server.environments.client.hot`; never the deprecated `server.hot`), client side via `import.meta.hot`. This satisfies §4.1(a) by construction: the channel is protected by Vite's post-CVE token handshake. Handles are handed on `vite:ws:connect` and closed on `vite:ws:disconnect` (§3.2–§3.3). Vite's client force-reloads the page when the dev server restarts, so reconnection collapses into the ordinary page-load path — §3.4 is satisfied by construction.

### 10.3 MCP door

The plugin starts `startBridgeServer` on the bridge port from `configureServer` and closes it when the dev server closes. The `EADDRINUSE` posture is §6.3's, including catching `port-in-use` so the Vite server survives.

### 10.4 Bootstrap

The plugin injects the bootstrap into the page itself — no client-side import in app code. The integration floor is: the plugin in `vite.config`, plus the app-owned dev-gated setup module (`if (import.meta.env.DEV) import('./switchboard')`) from the host-integration pattern. No trigger sugar ships: the gated import is already one transparent line.

### 10.5 Configuration

Plugin options per §9; `SWITCHBOARD_PORT` per §6.2.

## 11. `@switchboard-dev/adapter-next` (normative binding)

### 11.1 Shape

Server entry `@switchboard-dev/adapter-next`, client entry `@switchboard-dev/adapter-next/client`. The canonical integration is one server-side line:

```ts
// instrumentation.ts
export { register } from '@switchboard-dev/adapter-next'
```

plus one client-side line — the loader component in the root layout (§11.4).

### 11.2 Configuration: `createRegister`

The bare `register` re-export runs defaults. Options go through the configured variant — still one line:

```ts
export const register = createRegister({ invokeTimeoutMs: 120_000 })
```

with the §9 vocabulary. Environment precedence per §6.2 and §11.5.

### 11.3 Both doors on the bridge port

`register()` starts one in-process server on the bridge port carrying both doors — `POST/GET/DELETE /mcp` (Streamable HTTP) and the `/ws` upgrade for the page channel, via the shared WS door (§4.3) under the §4.2 policy. Mandatory guards, in order: `process.env.NEXT_RUNTIME === 'nodejs'` (multi-runtime passes); `process.env.NODE_ENV === 'development'` (§7.1); the `globalThis` idempotency flag (§7.2); the bounded `EADDRINUSE` retry then catch (§6.3 — `next dev` survives).

`next build` MUST never start the listener, under either bundler. This guard was reasoned but never exercised in the research; the adapter's conformance suite exercises it for both `next build` and `next build --webpack`.

### 11.4 Client entry

Two exports:

- **The bootstrap** — a bare side-effect import (`import '@switchboard-dev/adapter-next/client'`) implementing §8, including §3.4's reconnect-with-backoff, which no host channel provides here.
- **The loader component** — trigger sugar owning the dev gate and effect timing:

  ```tsx
  <SwitchboardDev load={() => import('@/switchboard')} />
  ```

  A client component whose effect runs the thunk only in development; the effect is what enforces client-only (client components execute during SSR, effects don't). The thunk keeps the import specifier in app code, so bundling and production elimination work. Hand-writing the equivalent three-line component remains supported and documented.

### 11.5 The page-side port mirror

The page bundle cannot read `SWITCHBOARD_PORT`; Next inlines only `NEXT_PUBLIC_*` variables. The documented override variable on Next is therefore **`NEXT_PUBLIC_SWITCHBOARD_PORT`** — readable by both sides, so it stays the one variable driving bridge, page, and (via `${NEXT_PUBLIC_SWITCHBOARD_PORT:-7654}` in `.mcp.json`) agents. `register()` reads `NEXT_PUBLIC_SWITCHBOARD_PORT`, then `SWITCHBOARD_PORT`, then the code option, then 7654 — and MUST emit a loud warning when `SWITCHBOARD_PORT` is set but the public mirror is absent or different, naming the fix: the page would otherwise dial the wrong port with no error anywhere.

## 12. Third-party adapters

A third-party adapter is bound by §§2–9 exactly as the shipped ones are. In brief: inject the wire client, never reimplement it (§1.1); MCP door on the bridge port (§2.1); open-only single-use handles with prompt close signaling (§3); a secured page channel with the loopback-any default (§4); `invokeTimeoutMs` exposed (§5); the port posture — one variable, fail loud, never scan, host survives (§6); inert outside dev, idempotent, stateless (§7); bootstrap injected, zero app-side bridge code (§8); the §9 option names. `bridge-mcp`'s node side (`startBridgeServer`, the WS door) SHOULD be reused rather than reimplemented.

Non-normative watch items, recorded so they are revisited rather than inherited: if `NextResponse.upgrade()` (Next RFC #95514) ships, both of adapter-next's doors could move to the app's port and the fixed-port posture SHOULD be re-evaluated (per the port research); tunneled/remote dev (Codespaces) may warrant a same-origin rewrite façade over the bridge port — unvalidated, out of v1.
