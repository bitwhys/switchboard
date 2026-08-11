# The exposure model

This file covers who can see which plugin capabilities, and why: the `bridge:*` grants, the `when` predicate, and where each is enforced. It does not cover how those decisions travel to the agent — that is [`bridge-flows.md`](./bridge-flows.md). Source of truth: [bridge §3](../spec/bridge-protocol.md#3-bridge-grants-mechanics), [kernel §14](../spec/kernel-api.md#14-the-wire-legal-rule).

Getting this wrong in either direction is a real bug: too much exposed, or something hidden that an agent needed.

## Two checks for commands

A command appears in the agent tool list only when both of these hold:

- the plugin has `bridge:commands`
- the command's `when` predicate, if it has one, currently evaluates to true

The two checks answer different questions ([bridge §3.3](../spec/bridge-protocol.md#33-permission--existence-when--listing)):

| | Permission (`bridge:*`) | `when` predicate |
|---|---|---|
| Question it answers | Does this exist at the bridge? | Is this listed right now? |
| Declared | In the manifest | In code, per command |
| Without it | Not announced, not listed, not dispatchable by agents, not forwarded | Hidden from the UI and agent tool list, but `commands.execute()` still works |
| Scope | All commands in a family for a plugin | Individual command |
| Changes over time | No | Whenever relevant context changes |
| Security boundary? | No. It controls exposure, not capability | No. It only affects presentation |

In short: permission controls existence, `when` controls listing. A command with `when: false` can still be dispatched from page code. A command from a plugin without `bridge:commands` is not exposed to the bridge at all.

## Three grant families

The `bridge:*` grants are closed by default, and each applies to a whole family for a plugin. Together with `when`, they determine exactly what an agent sees:

| Plugin grant | `when` (commands only) | What the agent sees |
|---|---|---|
| `bridge:commands` | true or absent | The command is listed as an MCP tool and can be invoked |
| `bridge:commands` | false | The tool is hidden; invoking it returns an `isError` response with a clear message |
| No `bridge:commands` | — | Nothing. In-page `commands.execute()` still works |
| `bridge:context` | — | The latest value of keys this plugin last wrote, tagged with the plugin id |
| No `bridge:context` | — | `present: false, reason: 'not-granted'` for keys it last wrote |
| `bridge:events` | — | Its events appear in `switchboard.events.tail` |
| No `bridge:events` | — | Its events stay in the page |

`feedback.open-count` is the worked example. The feedback plugin writes it, reads it back to drive a toolbar badge, and never holds `bridge:context`. So the key is fully functional in the page and simply does not exist at the bridge: an agent reading it gets `present: false, reason: 'not-granted'`. That is permission controlling existence, not a value being filtered out.

## How `when` is evaluated

A `when` predicate is a pure function over a read-only Context view. The kernel tracks which keys the predicate actually read, and re-runs it only when one of those keys changes.

## Where enforcement happens

| Place | What it enforces | Why there |
|---|---|---|
| The page | Filters what gets announced, forwarded, and answered | The kernel holds the manifests, not the dev server |
| The bridge | Checks the JSON rules and validates `outputSchema` before replying to the agent | The kernel does not inspect payloads deeply |

The bridge relies on the page to filter correctly. In v1 there is no grant check in the dev-server process itself ([bridge §3.5](../spec/bridge-protocol.md#35-enforcement-point-the-page)).

## Attribution is based on the actor

Event names and context keys are shared names, so the bridge cannot decide exposure from the name alone. It has to look at who performed the write or emission.

- A context key may be written by different plugins over time. A read returns the value only if the latest writer holds `bridge:context`
- An event name may cover both forwarded and unforwarded emissions. Each emission is judged by its emitter
- Every item crossing the bridge is tagged with the plugin id that acted, and tools carry that id in `_meta["switchboard/pluginId"]`

## Everything that crosses must be plain JSON

Command inputs and results, event payloads, and context values must all be plain JSON — values that survive a JSON round-trip unchanged ([kernel §14](../spec/kernel-api.md#14-the-wire-legal-rule)). The rule holds whether or not a `bridge:*` grant is present.

## The toolbar does not change exposure

The toolbar neither adds agent-visible surface nor removes any.

- A command item uses the same `when` rule as the command it wraps
- There is no separate item-level `enabledWhen`
- Adapters should not create panel-toggling commands. That would hand the adapter control over every plugin's panels at once, and blur which plugin an action belongs to
