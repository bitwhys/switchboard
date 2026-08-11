# The exposure model

This file explains who can see which plugin capabilities, and why. It is the part of the system where exposure mistakes can either show too much or hide something that should be available.

## Two checks for commands

A command appears in the agent tool list only when both of these are true:

- the plugin has `bridge:commands`
- the command’s `when` predicate, if present, currently evaluates to true

These two checks answer different questions:

| | Permission (`bridge:*`) | `when` predicate |
|---|---|---|
| Question it answers | Does this exist at the bridge? | Is this listed right now? |
| Declared | In the manifest | In code, per command |
| Without it | Not announced, not listed, not dispatchable by agents, not forwarded | Hidden from the UI and agent tool list, but `commands.execute()` still works |
| Scope | All commands in a family for a plugin | Individual command |
| Changes over time | No | Whenever relevant context changes |
| Security boundary? | No. It controls exposure, not capability | No. It only affects presentation |

In short: **permission controls existence, `when` controls listing**. A command with `when: false` can still be dispatched in page code; a command from a plugin without `bridge:commands` is not exposed to the bridge at all.

## Three grant families

The `bridge:*` grants are closed by default and apply to a whole family for a plugin.

| Grant held by plugin | What agents get |
|---|---|
| `bridge:commands` | Every listed command from that plugin, as an MCP tool |
| `bridge:events` | Every event from that plugin, forwarded into the tail buffer |
| `bridge:context` | That plugin’s context writes, readable through `switchboard.context.read` |
| None | Nothing from that plugin is exposed at the bridge |

## How `when` is evaluated

A `when` predicate is a pure function over a read-only Context view. The kernel tracks which keys were actually read during evaluation and re-runs the predicate only when one of those keys changes.

## Where enforcement happens

| Place | What it enforces | Why it is there |
|---|---|---|
| The page | Filters what gets announced, forwarded, and answered | The kernel holds the manifests, not the dev server |
| The bridge | Checks serialization rules and validates `outputSchema` before replying to the agent | The kernel does not inspect payloads deeply |

The bridge relies on the page to filter correctly. In v1, there is no grant check in the dev-server process itself.

## Attribution is based on the actor

Event names and context keys are shared names, so the bridge cannot decide exposure from the name alone. It has to look at who performed the write or emission.

- A context key may be written by different plugins over time; a read returns the value only if the latest writer has `bridge:context`
- An event name may include both forwarded and unforwarded emissions; each emission is judged by the emitter
- Each item that crosses the bridge is tagged with the plugin id that acted, and tools carry that id in `_meta["switchboard/pluginId"]`

## Serialization rules apply everywhere

A value must survive `JSON.parse(JSON.stringify(x))` unchanged to be considered wire-safe. That rule applies to command inputs and results, event payloads, and context values, whether or not a `bridge:*` grant is present.

## The toolbar does not change exposure

The toolbar does not add agent-visible surface or remove any.

- A command item uses the same `when` rule as the command it wraps
- There is no separate item-level `enabledWhen`
- Adapters should not create panel-toggling commands, because that would give the adapter control over every plugin’s panels at once and blur plugin attribution

## Summary table

| Plugin grant | `when` (commands only) | What the agent sees |
|---|---|---|
| `bridge:commands` | true or absent | Tool is listed and can be invoked |
| `bridge:commands` | false | Tool is hidden; invoking it returns an `isError` response with a clear message |
| No `bridge:commands` | — | Nothing; in-page `commands.execute()` still works |
| `bridge:context` | — | Latest value of keys this plugin last wrote, with plugin id |
| No `bridge:context` | — | `present: false, reason: 'not-granted'` for keys it last wrote |
| `bridge:events` | — | Its events appear in `switchboard.events.tail` |
| No `bridge:events` | — | Its events stay inside the page |

The file’s main example is `feedback.open-count`: it exists in page code, but it does not appear at the bridge because the feedback plugin does not hold `bridge:context`.
