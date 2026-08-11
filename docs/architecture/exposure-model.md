# The exposure model

**This file owns "who can see what, and why."** It is the most error-prone model in the system: getting it wrong means either leaking a plugin's surface to agents that shouldn't see it, or silently hiding one that should be there. The normative homes are [kernel §11](../spec/kernel-api.md#11-visibility-predicates-when)–[§12](../spec/kernel-api.md#12-permissions), [§14](../spec/kernel-api.md#14-the-wire-legal-rule) and [bridge §3](../spec/bridge-protocol.md#3-bridge-grants-mechanics), [§12](../spec/bridge-protocol.md#12-the-wire-legal-enforcement-point); this file only lines their rules up in one place.

## The two gates

A command appears in the agent tool list **iff** its plugin holds `bridge:commands` **and** its `when` predicate (if any) currently evaluates true ([bridge §3.3](../spec/bridge-protocol.md#33-permission--existence-when--listing)). The two gates do different jobs and never substitute for each other:

| | Permission (`bridge:*`) | `when` predicate |
|---|---|---|
| Question it answers | does this **exist** at the bridge? | is this **listed** right now? |
| Declared | statically, in the manifest | as code, per command |
| Without it | not announced, not listed, not dispatchable by agents, not forwarded | vanishes from UI surfaces and the agent tool list — but `commands.execute()` still works |
| Granularity | all-or-nothing per family per plugin | per command |
| Changes over time | never (manifest is static) | on every relevant context write |
| Security boundary? | no — gates trusted code's *exposure*, not its capability | no — presentation only, never gates dispatch |

**Permission = existence, `when` = listing.** A when-false command is still dispatchable in-page ([kernel §11.2](../spec/kernel-api.md#112-gates-listing-never-dispatch)); an ungranted plugin's command is not reachable by agents at all ([bridge §3.1](../spec/bridge-protocol.md#31-default-closed-existence)).

## The three grant families

The `bridge:*` family is **default-closed and all-or-nothing per family per plugin** ([kernel §12.2](../spec/kernel-api.md#122-the-v1-vocabulary--eight-strings), [bridge §3.2](../spec/bridge-protocol.md#32-all-or-nothing-per-family)). There is no partial visibility, no read-only tier, no per-registration opt-out in v1.

| Grant held by plugin | What agents get |
|---|---|
| `bridge:commands` | every listed command of that plugin, as an MCP tool |
| `bridge:events` | every emission by that plugin, forwarded into the tail buffer |
| `bridge:context` | that plugin's context **writes**, readable via `switchboard.context.read` |
| *(none)* | nothing — the plugin's registrations do not exist at the bridge |

## `when`: the tracked-read evaluation model

A `when` predicate is a plain pure function over a read-only Context view. The kernel records which keys each evaluation **actually reads** and re-evaluates only when one of those keys changes, re-tracking every run — a predicate's dependencies *are* its reads, so they cannot drift from the code. A throwing predicate is contained: the evaluation counts as `false` and a `when-failed` dev-mode warning reports it ([kernel §11.1](../spec/kernel-api.md#111-the-tracked-read-context-view)).

## Two enforcement points

| Point | Enforces | Why there |
|---|---|---|
| **The page** | grant filtering: announce, forward, and answer only granted material | the kernel holds the manifests; the dev server does not ([bridge §3.5](../spec/bridge-protocol.md#35-enforcement-point-the-page)) |
| **The bridge** | wire-legality (where serialization happens) and `outputSchema` validation before answering the agent | the kernel never deep-inspects payloads; the bridge is the cop ([bridge §12](../spec/bridge-protocol.md#12-the-wire-legal-enforcement-point), [§10.4](../spec/bridge-protocol.md#104-outputschema-enforcement)) |

The bridge trusts the page's filtering — consistent with v1's trusted-code posture. Note what this means for reading the system: **no grant check exists anywhere in the dev-server process.**

## Attribution is by act, never by name ownership

Event names and context keys are open channels ([kernel §2.2](../spec/kernel-api.md#22-name-kinds)): many plugins may emit or write the same name. So the bridge cannot ask "is this *name* granted?" — it asks "is this *act's actor* granted?" ([bridge §3.4](../spec/bridge-protocol.md#34-act-based-attribution)):

- The same context key may hold a granted plugin's write now and an ungranted plugin's write later; a read answers with the value **iff the latest writer holds `bridge:context`**, else `present: false, reason: 'not-granted'` ([bridge §8.2](../spec/bridge-protocol.md#82-grant-semantics)).
- The same event name may carry forwarded and unforwarded emissions; each emission is judged by its emitter ([bridge §9.1](../spec/bridge-protocol.md#91-event-push)).
- Every item crossing the bridge is tagged with the acting plugin's id; on tools it surfaces as `_meta["switchboard/pluginId"]` ([bridge §10.3](../spec/bridge-protocol.md#103-attribution-and-annotations)).

## Wire-legality is unconditional

The wire-legal rule — a value survives `JSON.parse(JSON.stringify(x))` unchanged — binds Command inputs and results, Event payloads, and Context values **whether or not any `bridge:*` grant is held** ([kernel §14.2](../spec/kernel-api.md#142-binding)). If it were grant-conditional, adding a grant later would break a plugin's own working data. Grants decide *exposure*; wire-legality is a property of the *data*, always.

## The toolbar's zero delta

The strip adds no agent surface and subtracts none ([toolbar §9](../spec/toolbar-contract.md#9-agents-and-the-toolbar)):

- A command item inherits its bound command's `when` **verbatim** — there is no item-level `enabledWhen` — so anything command-bound in the strip is agent-invocable by construction, under the *command's own plugin's* grants, exactly as if the item did not exist ([toolbar §4.2](../spec/toolbar-contract.md#42-command-items-are-presentation-only)).
- Adapters must not manufacture panel-toggling commands: they would sit under the *adapter's* grant, flipping UI-steering on for every plugin's panels at once and breaking per-plugin attribution.

## The whole model in one table

For any registration, what an agent can observe:

| Plugin's grant | `when` (commands only) | Agent sees |
|---|---|---|
| `bridge:commands` | true / absent | tool listed and invocable |
| `bridge:commands` | false | tool not listed; invoking answers `isError` with honest text — indistinguishable *by error class* from never-existed ([bridge §10.5](../spec/bridge-protocol.md#105-error-model)) |
| no `bridge:commands` | — | nothing; in-page `commands.execute()` unaffected |
| `bridge:context` | — | latest value of any key **this plugin last wrote**, with its plugin id |
| no `bridge:context` | — | `present: false, reason: 'not-granted'` for keys it last wrote |
| `bridge:events` | — | its emissions in `switchboard.events.tail` |
| no `bridge:events` | — | its emissions never leave the page |

The flagship negative demonstration — `feedback.open-count` existing in-page but not at the bridge because the feedback plugin deliberately holds no `bridge:context` — is walked through in [`feedback-loop.md`](./feedback-loop.md).
