# Topology

This file covers where Switchboard runs: the three execution environments, the two paths into the bridge, the process and security boundaries, and multi-tab behavior. It does not cover what travels over those paths — that is [`bridge-flows.md`](./bridge-flows.md) — or who is allowed to see it, which is [`exposure-model.md`](./exposure-model.md). Source of truth: [bridge §1](../spec/bridge-protocol.md#1-scope-and-topology), [§15](../spec/bridge-protocol.md#15-security-posture-auth-v1), [adapter contract §2](../spec/adapter-contract.md#2-topology-the-two-doors).

## The three execution environments

Switchboard spans three environments that do not share memory ([bridge §1](../spec/bridge-protocol.md#1-scope-and-topology)):

```mermaid
flowchart LR
  subgraph agent["Agent environment — outside the browser"]
    AGENT["MCP client<br/>(Claude Code, Cursor, …)"]
  end
  subgraph server["Dev-server process"]
    EDGE["MCP edge<br/>one MCP server instance<br/>per agent session"]
    BRIDGE["bridge core<br/>canonical registry · tail buffer<br/>outputSchema validator"]
    ADAPTER["adapter<br/>(adapter-vite / adapter-next)"]
    EDGE --- BRIDGE
    ADAPTER -->|"page channel"| BRIDGE
  end
  subgraph page["Page — one browser tab"]
    BOOT["bootstrap<br/>(adapter-injected)"]
    WIRE["page client<br/>(bridge-mcp, browser export)"]
    KERNEL["kernel (core)<br/>the four registries"]
    PLUGINS["plugins<br/>(including the toolbar)"]
    BOOT -->|"attaches"| WIRE
    WIRE -->|"observes via the handoff"| KERNEL
    PLUGINS -->|"PluginApi"| KERNEL
  end
  AGENT -->|"path 1: MCP over<br/>Streamable HTTP"| EDGE
  WIRE <-->|"path 2: the Switchboard<br/>protocol"| ADAPTER
```

What runs where:

| Environment | Runs | Holds |
|---|---|---|
| Agent | Any MCP client | Its own MCP config (`.mcp.json` with the bridge URL) |
| Dev-server process | The adapter, the bridge core, the MCP edge (`bridge-mcp` node side) | The canonical registry, the tail buffer, the `outputSchema` validator ([bridge §10.4](../spec/bridge-protocol.md#104-outputschema-enforcement)) |
| Page | The kernel, the plugins, the toolbar, the page client, the adapter bootstrap | The plugin manifests and registries; grant filtering happens here ([bridge §3.5](../spec/bridge-protocol.md#35-enforcement-point-the-page)) |

There is no fourth environment. The kernel is client-only, and SSR does not create one: server code never calls `createSwitchboard`, so under Next there is no server-side kernel.

## Two paths, two protocols

The bridge translates between two protocols ([bridge §1](../spec/bridge-protocol.md#1-scope-and-topology)):

- **The agent path uses MCP** over Streamable HTTP. By default that is `http://localhost:7654/mcp`, on the dedicated bridge port rather than the app port ([adapter contract §2.1](../spec/adapter-contract.md#21-the-mcp-door-lives-on-the-bridge-port))
- **The page path uses the Switchboard protocol** — a small envelope of typed JSON messages, not MCP and not JSON-RPC

The page path is deliberately not MCP. Keeping the two protocols apart stops agent messages leaking into the page layer.

### Path, protocol, channel, connection

These four words name four different things, and this directory uses each only in its own sense:

| Term | What it names |
|---|---|
| **path** | which of the two ways into the bridge: the agent path or the page path |
| **protocol** | the language spoken on a path — MCP on the agent path, the Switchboard protocol on the page path |
| **channel** | the transport carrying the page path: Vite's HMR WebSocket, or a dedicated one |
| **connection** | one tab's live session over that channel — it has a lifetime, gets a tab id, drops, and reconnects |

A channel carries a connection, over which a protocol is spoken, on a path.

The Switchboard protocol does not care which channel carries it. A channel must deliver messages in order, reliably, and in both directions, and it must signal disconnection to both ends ([bridge §4.2](../spec/bridge-protocol.md#42-channel-requirements)). Anything meeting those four requirements will do; the shipped adapters supply the channel for the page path.

## Process boundaries

The page side of the Switchboard protocol is implemented once, by the page client — the browser-only export from `bridge-mcp`. Adapters inject it and hand it a live, single-use connection handle.

Everything in the dev-server process is per-process and in memory: one bridge, one canonical registry, and one session map per dev-server process ([adapter contract §2](../spec/adapter-contract.md#2-topology-the-two-doors)).

## The security boundary

The v1 threat model is the malicious website against the localhost dev server, including DNS rebinding and cross-site WebSocket hijacking. It is not a boundary against local processes.

The boundary, by path:

- **Binding** — both paths bind loopback only, and should bind both `127.0.0.1` and `::1`, because Node resolves `localhost` inconsistently ([bridge §15.1](../spec/bridge-protocol.md#151-binding))
- **Agent path** — an Origin allowlist rejects disallowed origins before protocol processing. Requests with no Origin header are accepted, because terminal agents do not send one and rejecting them would break valid local use
- **Page path** — the channel either rides a host channel with its own handshake protection, or enforces an Origin allowlist itself. The default allowlist accepts loopback origins
- **Reserved `auth` field** — the `hello` message carries an optional `auth` field that v1 accepts and ignores, so a later adapter can require credentials without changing the message shape

## Multi-tab and the active tab

Several tabs may connect at once, each with its own connection, handshake, and snapshot. Agents still see one canonical surface: the tool list exposed to an agent must not vary by which tab is active.
