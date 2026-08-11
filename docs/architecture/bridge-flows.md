# Bridge flows

This file covers wire behavior: connection and reconnection, snapshot sync, invocation and cancellation, context reads, and events polling. Static process layout is covered in [`topology.md`](./topology.md), and bridge exposure rules are covered in [`exposure-model.md`](./exposure-model.md). Source of truth: [bridge §4–§9](../spec/bridge-protocol.md#4-the-wire-envelope), [§13–§14](../spec/bridge-protocol.md#13-active-tab-and-multi-tab).

Lifelines used throughout: **agent** (any MCP client) · **bridge** (`bridge-mcp` node side: MCP edge + bridge core) · **wire client** (`bridge-mcp` browser export, attached by the adapter's bootstrap) · **kernel** (`core`, in the page).

## Connection

A tab's connection over its lifetime ([bridge §5](../spec/bridge-protocol.md#5-handshake), [§14](../spec/bridge-protocol.md#14-page-absence-and-reconnection)):

```mermaid
stateDiagram-v2
    [*] --> Handshaking : channel established — page sends hello first
    Handshaking --> Connected : hello-ok (bridge mints stable tabId)
    Handshaking --> Rejected : hello-reject (version mismatch) — connection closed
    Connected --> Connected : snapshots, invokes, reads, events
    Connected --> Dropped : channel lost
    Dropped --> Handshaking : reconnect within grace — fresh hello, fresh snapshot
    Dropped --> Removed : grace period expires (~3 s) — commands delisted
    Removed --> Handshaking : page returns later — same messages as first connect
    Rejected --> [*]
```

- `hello` is the first message on every connection, including reconnections. There is no resume protocol or resync protocol. `hello-ok` mints a tab id stable for the connection lifetime; `hello-reject` carries both protocol versions, both kernel API versions, and a plain-language reason. The page shows "reload this tab," and the bridge reports the status via `switchboard.status` ([bridge §5.3](../spec/bridge-protocol.md#53-rejection), [§11.1](../spec/bridge-protocol.md#111-switchboardstatus)).
- The grace period ([bridge §14.2](../spec/bridge-protocol.md#142-the-grace-period)) is sized so ordinary page reloads reconnect inside it (~3 s recommended). A reconnecting page re-announces the same snapshot, so a common reload usually produces no agent-visible change. Only a genuinely absent page shrinks the tool list.
- Reconnection uses the same handshake and snapshot messages as first connect, so no resume state is required for correctness ([bridge §14.3](../spec/bridge-protocol.md#143-reconnection)). Channel retry/backoff remains an adapter concern, not wire protocol ([adapter contract §3.4](../spec/adapter-contract.md#34-reconnection)).
- Active-tab failover: when several tabs are connected, the canonical agent-facing registry mirrors the active tab (most recently focused; tabs send `focus`). If the active tab drops, the bridge fails over to another connected tab, subject to the grace period; agents receive the switch as a normal registry diff ([bridge §13.2](../spec/bridge-protocol.md#132-the-active-tab-model)).
- With no connected page, the MCP endpoint stays available: the three built-in tools remain functional, and invoking a page command returns an actionable `isError` ([bridge §14.1](../spec/bridge-protocol.md#141-the-endpoint-stays-up)).

## Snapshot sync

Registry sync uses full snapshots and no delta protocol, which avoids drift between page and bridge state ([bridge §6](../spec/bridge-protocol.md#6-registry-sync-snapshots)):

```mermaid
sequenceDiagram
    participant K as kernel
    participant W as wire client
    participant B as bridge
    participant A as agent
    Note over K,W: triggers — plugin activation/disposal,<br/>command registration/disposal, a `when` flip
    K->>W: commands.observe fires (full array)
    W->>W: filter to agent-listable<br/>(bridge:commands ∧ when-true), debounce
    W->>B: snapshot — the COMPLETE current surface
    B->>B: diff against canonical registry,<br/>apply only real deltas
    alt something actually changed
        B-->>A: one batched tools/list_changed per session
    else identical snapshot (the normal reload case)
        Note over B,A: zero agent-visible change
    end
    A->>B: tools/list (any time)
    B-->>A: rebuilt from the canonical registry,<br/>schemas verbatim
```

The page computes both filters itself because it holds the manifests ([bridge §6.2](../spec/bridge-protocol.md#62-what-the-page-announces)); a burst of changes yields one debounced message. Change notifications are lossy cache-invalidation hints: a client that ignores them and re-lists still sees the canonical state ([bridge §10.1](../spec/bridge-protocol.md#101-transport-and-sessions)).

## Invocation

The full lifecycle of one agent call ([bridge §7](../spec/bridge-protocol.md#7-invocation-lifecycle)):

```mermaid
stateDiagram-v2
    [*] --> InFlight : bridge mints id, sends invoke
    InFlight --> Done : result (ok or error) — answered to agent
    InFlight --> Cancelling : agent cancels / 60 s timeout / agent disconnects
    Cancelling --> Done : page fires the AbortSignal — late result discarded, silence tolerated
    InFlight --> FailedImmediately : page channel drops mid-invoke
    FailedImmediately --> [*] : isError — outcome unknown, no grace-period wait
    Done --> [*]
```

```mermaid
sequenceDiagram
    participant A as agent
    participant B as bridge
    participant W as wire client
    participant K as kernel
    A->>B: tools/call
    B->>W: invoke { id, command, input }
    W--)K: dispatch DETACHED (source: 'agent', fresh AbortSignal)
    Note over W: the listener returns synchronously —<br/>it never awaits the handler
    A->>B: cancel (or the 60 s timeout expires)
    B->>W: cancel { id }
    W->>K: fire that invocation's AbortSignal
    K--)W: result (or the handler ignores its signal and finishes)
    W->>B: result { id, ok, value | error }
    B->>B: validate against declared outputSchema
    B-->>A: tool result (isError on any failure, naming the command)
```

- The wire-pump rule ([bridge §7.2](../spec/bridge-protocol.md#72-the-wire-pump-rule)) is that dispatch runs detached and the message listener returns synchronously. If the listener `await`s a running handler, the wire stalls, including delivery of `cancel`. This was observed directly in transport testing when inline awaiting delayed cancellation until command completion.
- Three causes, one path: agent-side cancellation, bridge timeout (default 60 s), and agent disconnect mid-call all converge on the same `cancel` message. Cancellation is cooperative and best-effort; if a handler ignores its signal and finishes, the bridge tolerates either a late `result` (discarded) or silence ([bridge §7.3](../spec/bridge-protocol.md#73-cancellation), [§7.4](../spec/bridge-protocol.md#74-bridge-timeout)).
- Disconnect mid-invoke fails immediately with *page disconnected during invocation; outcome unknown*. The bridge does not wait through the grace period because the invocation outcome is already unknown ([bridge §7.5](../spec/bridge-protocol.md#75-disconnect-mid-invoke)).

## Context reads

A context read is a **live round-trip to the page** — the bridge keeps no mirror and no cache anywhere, so there is no staleness story ([bridge §8](../spec/bridge-protocol.md#8-context-reads)):

```mermaid
sequenceDiagram
    participant A as agent
    participant B as bridge
    participant W as wire client
    A->>B: switchboard.context.read { key }
    B->>W: context-read { id, key }
    W->>W: latest value + writer's grant check
    alt latest writer holds bridge:context
        W->>B: context-value { present: true, value, pluginId }
    else no value at all
        W->>B: context-value { present: false, reason: 'unset' }
    else value exists, writer ungranted
        W->>B: context-value { present: false, reason: 'not-granted' }
    end
    B-->>A: value with writer, or an actionable error
```

The two `present: false` reasons exist so the built-in tool can report something actionable rather than a bare miss ([bridge §8.2](../spec/bridge-protocol.md#82-grant-semantics), [§11.2](../spec/bridge-protocol.md#112-switchboardcontextread)).

## Events → the tail buffer

Events are pushed from page to bridge, then recorded; agents retrieve them by polling (`switchboard.events.tail`) rather than receiving server push ([bridge §9](../spec/bridge-protocol.md#9-events-and-the-tail-buffer)):

```mermaid
sequenceDiagram
    participant K as kernel
    participant W as wire client
    participant B as bridge
    participant A as agent
    K->>W: emission by a plugin holding bridge:events
    W->>B: event { name, payload, pluginId, timestamp } — no ack
    B->>B: append to bounded ring buffer (default 100)<br/>+ tabId + monotonic sequence number
    A->>B: switchboard.events.tail { since?, limit? }
    B-->>A: buffered entries, newest-last
```

The bridge keeps the tail buffer as a subscriber; kernel Events remain ephemeral and are not buffered in the kernel ([kernel §7](../spec/kernel-api.md#7-events)). Sequence numbers support incremental polling. The buffer survives page reloads and disconnections, but it is process-lifetime only and is cleared when the dev server stops ([bridge §9.2](../spec/bridge-protocol.md#92-the-tail-buffer), [§14.4](../spec/bridge-protocol.md#144-what-dies-with-the-server)).
