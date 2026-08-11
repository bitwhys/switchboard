# Switchboard v1 Spec Suite

Switchboard is an open-source, pluggable in-application developer tool runtime: a Vercel-Toolbar-shaped surface an application developer composes from plugins, with agent invocability as a first-class goal: what a plugin registers in the page is, under the plugin's own grants, what an agent can call over MCP.

This directory is the complete v1 design: two specifications, two capability contracts, four reference-plugin briefs, and this index. Implementation starts from here with no open design questions. The evidence the suite cites lives beside it in [`../research/`](../research), [`../shadow-dom-a11y-patterns.md`](../shadow-dom-a11y-patterns.md), and [`../../prototypes/`](../../prototypes); the domain glossary is [`CONTEXT.md`](../../CONTEXT.md) at the repo root.

## Reading order

Kernel → bridge → contracts → briefs. The kernel spec is first on purpose: it is the one place that defines the three cross-cutting rules (the naming grammar, the permission strings, and the plain-JSON rule), that every other document cites by section link and never paraphrases.

| # | Document | What it binds | Kind |
|---|---|---|---|
| 1 | [`kernel-api.md`](./kernel-api.md) | the framework-agnostic runtime: plugin definition, activation, the four primitives, capabilities, `when`, permissions, storage, the plain-JSON rule | specification |
| 2 | [`bridge-protocol.md`](./bridge-protocol.md) | the page ⇄ agent boundary: message envelope, handshake, snapshot sync, invocation, tail buffer, built-in tools, the MCP edge | specification |
| 3 | [`toolbar-contract.md`](./toolbar-contract.md) | the `toolbar` capability: items, badges, panels, the mount contract, chrome, a11y patterns P1–P8 | capability contract |
| 4 | [`dom-inspector-contract.md`](./dom-inspector-contract.md) | the `dom.inspector` capability: ElementReference, the registry, hydration facets, the picker, element descriptions | capability contract |
| 5 | [`plugins/metrics.md`](./plugins/metrics.md) | the pure producer: headless Web Vitals telemetry | brief |
| 6 | [`plugins/inspector.md`](./plugins/inspector.md) | the infrastructure provider: v1 reference provider of `dom.inspector` | brief |
| 7 | [`plugins/scanner.md`](./plugins/scanner.md) | the UI-heavy consumer: on-demand axe-core scans | brief |
| 8 | [`plugins/feedback.md`](./plugins/feedback.md) | the main one: annotations and the human → agent → human loop | brief |

The division of labor: the kernel spec holds what a contract is. The bridge spec holds what the bridge does about it, a capability contract holds what its provider must deliver, and a brief describes a concrete plugin — briefs carry no version header and bind no one.

## Versions

| Surface | Version | Where defined |
|---|---|---|
| Kernel API (manifest schema and permission strings included) | v1 | [`kernel-api.md`](./kernel-api.md) |
| Bridge protocol | `BRIDGE_PROTOCOL_VERSION: 1` (integer, exact-match-or-refuse) | [`bridge-protocol.md` §2](./bridge-protocol.md#2-versioning-the-handshake-gate) |
| Toolbar placement contract | `toolbar@1.0.0` (capability semver) | [`toolbar-contract.md` §2.2](./toolbar-contract.md#22-versioning) |
| Element identity contract | `dom.inspector@1.0.0` (capability semver) | [`dom-inspector-contract.md` §8](./dom-inspector-contract.md#8-versioning) |

Plugin manifest `version` fields are informational only; compatibility work stays on capability semvers.

## The four primitives

Defined by their bridge semantics, in that Command, Event, and Context can cross to agents while Service never does ([kernel spec §5–§9](./kernel-api.md#5-pluginapi)):

- **Command** — a named, invocable operation; the unit agents invoke as MCP tools. One structured input, serializable result.
- **Event** — a fire-and-forget announcement that something *happened*. Strictly ephemeral: never replayed, never buffered by the kernel; a late subscriber missed it. (The bridge's tail buffer is a *subscriber's* recording, not kernel replay.)
- **Context** — a named, observable *value*: latest state, replayed synchronously to every new observer. The home of "what is true right now."
- **Service** — a live in-page object shared between plugins. Never serialized, never bridged.

Two boundary rules sort everything: *need the latest value later → Context; only announcing a moment → Event*, and *live object → Service; data → everything else, where data means strict JSON* (the plain-JSON rule, [kernel spec §14](./kernel-api.md#14-the-plain-json-rule)). Storage is kernel infrastructure beside the primitives, not a fifth one ([kernel spec §13](./kernel-api.md#13-storage)); the four-primitive rule was deliberately stress-tested and survived ([`prototypes/primitive-stress-test/`](../../prototypes/primitive-stress-test/README.md)).

## Coverage matrix

The four reference plugins are chosen so that every v1 kernel/bridge/storage feature is validated by at least one plugin or carries an explicit waiver. The bridge-grant spread is deliberate (metrics `context+events` · inspector `commands+context` · feedback `commands+events` · scanner all three), so partial and full families are exercised without contrivance.

| Feature | Validated by |
|---|---|
| Command registration, schemas, dispatch over the bridge | inspector, scanner, feedback |
| ElementReference as command input | scanner (`a11y.scan`) |
| In-page cross-plugin dispatch (`invocation.source: 'plugin'`) | feedback → `dom.pick-element` |
| Event ephemerality + tail-buffer visibility | metrics, scanner, feedback |
| In-page cross-plugin Event subscription | feedback ← `a11y.scan-completed` |
| Context sync replay, whole-value replace | metrics (per-vital keys), scanner, inspector |
| Command-less, UI-less plugin via built-ins only | metrics |
| Service provision + capability semver | inspector (`dom.inspector@1.0.0`) |
| Hard `requires` + [loud](./diagnostics.md#21-loud-errors) activation failure | scanner, feedback |
| `tryGet`, present path | inspector → `toolbar` |
| `tryGet`, absent path | feedback → `feedback.sink` |
| `when` predicates (tracked-read Context view) | command items inherit `when` ([toolbar contract §4.2](./toolbar-contract.md#42-command-items-are-presentation-only)); event-derived visibility strain examined in [stress-test scenario 3](../../prototypes/primitive-stress-test/README.md) |
| Partial and full `bridge:*` grant families | the deliberate spread above |
| Permission = existence, in the negative | feedback (`feedback.open-count`, no `bridge:context`) |
| `dom:read` / `dom:write` advisories carried honestly | inspector, scanner |
| Storage: `storage:use`, outbox, defensive reads, reload survival | feedback |
| Panel mount contract, chrome, badges | scanner, feedback |
| Plain-JSON rule across all three bridgeable primitives | all four |
| A real third-party npm dependency | scanner (axe-core) |

**Explicit waivers** — features validated by no reference plugin, with the reason on record:

1. **`network:observe` / `network:request`** — first honest carrier is the future `feedback.sink` provider, which sits past the v1 destination.
2. **Manifest negative behaviors** (unknown-permission tolerance, malformed-manifest rejection) — kernel contract tests, not plugin behavior.
3. **Bridge mechanics** (snapshot sync, grace period, active tab, version refusal) — division of labor: validated by the transport spike (`spikes/`, wayfinder #9) and bound in the bridge spec, not exercised by plugin choice.

## Where this came from

*Not binding.* The suite consolidates the resolutions of the Switchboard formalization map ([wayfinder map #1](https://github.com/bitwhys/switchboard/issues/1)) — thirteen design tickets plus five writing tickets. Each document carries its own *Consolidates* lines; the per-decision detail lives on the closed tickets.
