# Switchboard — Domain Glossary

The ubiquitous language for Switchboard, an open-source, pluggable in-application developer tool runtime. Terms only — implementation detail lives in the spec suite and ADRs.

## Kernel & plugins

- **Kernel** — the framework-agnostic runtime (`core`) that hosts plugins and owns the four primitives' registries. Has no domain vocabulary of its own and never imports UI frameworks.
- **Plugin** — a unit of trusted code installed by the application developer, packaged as a single definition object: a static **Manifest** plus an imperative `setup` entry point. Identified by a **Plugin id** (`publisher.name`).
- **Manifest** — the static, statically-extractable half of a plugin: identity, its **capability** declarations (`provides`/`requires`), its **permissions**, and its **activation hints**. Readable without executing code; its schema (and the permission vocabulary) versions with the kernel API — there is no separate manifest version.
- **Permission** — a manifest-declared claim (`area:action`) naming a surface the kernel or bridge can gate. Every permission carries an **enforcement status**: *enforced* (the kernel/bridge honors it today — the `bridge:*` family and `storage:use`) or *advisory* (descriptive in v1, gateable under future sandboxing — the page-world family). Unknown permission strings are carried but grant nothing.
- **Activation hint** — a manifest entry naming a condition that may wake the plugin; hints are additive (any one suffices). v1 defines exactly one: `eager`, the default. Carried but unused in v1.
- **PluginApi** — the handle a plugin's `setup` receives; the only door into the kernel. Grouped by primitive. (Deliberately *not* called "PluginContext" — the word **Context** belongs exclusively to the primitive.)
- **Disposable** — the universal teardown token: every registration returns one, and the kernel tracks them all, so plugin deactivation cleans up everything the kernel can see.
- **Activation** — the moment the kernel checks a plugin's required capabilities and, if satisfied, runs its `setup`. Activation order is owned by the application developer; the kernel never reorders.

## The four primitives

Defined by their bridge semantics: Command, Event, and Context can cross to agents; Service never does.

- **Command** — a named, invocable operation with optional schemas and behavioral hints; the unit agents invoke as MCP tools. Takes one structured input, returns serializable data.
- **Event** — a named, fire-and-forget announcement that something *happened*. Strictly ephemeral: never replayed, never buffered; a late subscriber missed it.
- **Context** — a named, observable *value*: the latest state, replayed immediately to every new observer. The home of "what is true right now."
  - The boundary rule: *need the latest value later → Context; only announcing a moment → Event.*
- **Service** — a named, live in-page object shared between plugins. Never serialized, never bridged; the only primitive that stays entirely inside the page.
- **Wire-legal** — the serializability contract for the three bridgeable primitives: a value is legal iff it survives a strict JSON round-trip unchanged (no dates, binaries, maps, cycles). Binds Command inputs/results, Event payloads, and Context values *unconditionally* — bridge grants never change the contract. Enforced where serialization already happens (the bridge), never policed by the kernel.
  - The boundary rule: *live object → Service; data → everything else, and data means strict JSON.*

## Capabilities

- **Capability** — an opaque named claim a plugin `provides` or `requires`, optionally versioned. By convention a capability name coincides with the service or context key it promises.
- **Checked, not solved** — Switchboard's capability posture: a flat presence-and-version check with loud named errors; no dependency resolver, no activation reordering. At most one installed provider per capability name.

## Storage

Kernel infrastructure (alongside Disposable), not a fifth primitive: nothing is registered, listed, or `when`-gated, and storage never crosses the bridge — agent visibility only happens when a plugin deliberately publishes stored data through a Command or Context key.

- **Storage area** — the persistence façade a plugin sees: an async, JSON-valued key-value store bound invisibly to the plugin's id. A plugin can never name, choose, or escape its area, and there is no cross-plugin storage access — shared persistent state is a Service.
  - The boundary rule: *state that must survive a reload → storage; state others must see → egress (bridge or network), never storage — Switchboard is not a system of record.*
- **Storage engine** — the swappable backend behind every storage area, chosen by the application developer at kernel construction and invisible to plugins. Physical isolation of areas is the engine's job; the engine seam is public API, so backends beyond the built-in defaults need no kernel changes.
- **Defensive read** — the documented convention for stored-value shape: storage is untrusted input, validated on read, discarded or defaulted on mismatch. The kernel guarantees only that a plugin's area stays *reachable* across kernel upgrades; the shape of what is inside belongs to the plugin (no kernel migration machinery).

## Surfaces & the bridge

- **Bridge** — the translation layer between the page kernel and out-of-page agents; speaks Switchboard's own versioned wire protocol page-side and MCP at the agent-facing edge.
- **Visibility predicate** (`when`) — a pure function over Context deciding whether a command is *listed* (in UI surfaces and the agent tool list). Gates listing, never dispatch, and is never a security boundary.
- **Behavioral hints** (annotations) — MCP-shaped, untrusted advisories on a command (read-only, destructive, idempotent). Hints for UX and agent policy, never enforcement.
- **Bridge grant** — a `bridge:*` permission. Default-closed and all-or-nothing per primitive family: without the grant a plugin's registrations don't exist at the bridge (not listed, not dispatchable). Attribution is by *act*: the bridge forwards what a granted plugin registered, emitted, or wrote — never by name ownership.
- **Reserved namespace** — `switchboard.*` names belong to the kernel itself; no plugin, including first-party reference plugins, may register there. The bridge's **built-in tools** (`switchboard.status`, `switchboard.context.read`, `switchboard.events.tail`) live here: always present, they work — or fail with actionable errors — whether or not a page is connected.
- **Wire protocol** — the bridge's page-side language: Switchboard's own minimal envelope of typed JSON messages (never MCP, never JSON-RPC), correlated request/response by echoed id, defined as plain objects so any adapter channel can carry them.
- **Bridge protocol version** — the plain integer gating the wire handshake, bumped only on breaking wire changes. Exact match or clean refusal; the kernel API version travels alongside for diagnostics only. The only real-world mismatch is a stale tab, and the remedy is always reload.
- **Snapshot sync** — the registry-sync model: the page always sends its complete current registry (on connect and, debounced, on any change); the bridge diffs against canonical state and applies only real deltas to the agent-facing surface. The wire stays dumb, drift is impossible, and reconnect needs no special resync.
- **Tail buffer** — the bridge's bounded ring buffer of recent events, served to agents as a poll tool. A recording kept by the bridge *as a subscriber* — kernel Events stay strictly ephemeral; the buffer survives page reloads and dies with the dev server.
- **Active tab** — the one connected page the agent-facing surface mirrors and invocations target: the most recently focused tab, falling back to most recently connected. Every connection carries a stable **tab id** (reserved for future explicit targeting; surfaced in status today).
- **Grace period** — the short debounce before a departed page's commands leave the tool list, sized so a page reload reconnects invisibly. Only a genuinely absent page shrinks the list — which then tells the truth: built-ins only.

## Toolbar adapter

- **Toolbar service** — the toolbar adapter's contribution surface: a Service named `toolbar`, backed by the like-named capability. The *only* door for placement; the kernel carries no placement vocabulary. Plugins that must have toolbar presence `require` it; plugins that merely prefer it probe with `tryGet` and stay headless-safe.
- **Placement contract version** — the `toolbar` capability's semver, which versions the placement vocabulary itself (not the npm package). The contract belongs to the capability name: any adapter that honestly provides `toolbar@<semver>` is a toolbar, and plugins cannot tell implementations apart.
- **Command item** — a contributed trigger in the toolbar strip that is presentation only: it *binds* a registered command (or toggles a panel) and never carries behavior or visibility logic of its own. A command-bound item inherits the command's `when` predicate and vanishes with it.
- **Panel** — a contributed surface the plugin renders into; the adapter owns its chrome and open/closed state. Panel toggling is presentation, not a command — agents cannot steer the toolbar UI in v1.
- **Panel chrome** — everything around a panel's body: frame, header, close affordance, sizing, focus management, and screen-reader announcements. Owned entirely by the adapter's shared UI layer; a plugin's world begins and ends at the container it is handed.
- **Mount contract** — the framework-agnostic seam between adapter and panel body: DOM container in, Disposable out; mounted on open, disposed on close. Surviving state belongs to Context or storage, never the mounted DOM.
- **Badge** — a property of a command item (count or dot), fed by a Context key the plugin names. Not a contribution kind.
- **Strip** — the toolbar's single contributable region in v1; implicit (no `slot` field exists yet — `slot` and `group` are reserved future placement fields).
- **Cluster** — the unit of strip ordering: each plugin's items render adjacently, clusters follow plugin activation order (application-developer owned), and an item's `order` number positions it only within its own plugin's cluster. Cross-plugin interleaving is deliberately unsayable.

## Element identity (`dom.inspector`)

Domain vocabulary owned by the `dom.inspector` capability, not the kernel — the capability contract (and its semver) defines the shape, minting, resolution, and hydration of element identity, the same way `toolbar` owns placement.

- **ElementReference** — a registry-minted opaque handle to a live DOM node *instance* (not a logical position: a framework remount mints a new identity). Carries only a closed display envelope — kind brand, id, tag, mint-time label — everything else is hydration. Valid only within the minting page session; ids never repeat across sessions.
- **Element registry** — the inspector's id→node map behind every reference. Never pins: minting a reference must not keep DOM alive, and garbage collection is the only collector (no release API).
- **Stale reference** — the single resolution failure: the node was collected, or the id is unknown here. Never subdivided further — the registry cannot reliably tell the cases apart. Detachment is *not* death: an out-of-document but alive node still resolves, reported as disconnected.
- **Hydration** — fetching element detail on demand instead of shipping it eagerly. In-page, hydration is the live node itself (resolve on the service); over the bridge, it is one inspector-owned describe command whose **facets** (attributes, geometry, a11y, description, …) name exactly what the caller wants. The facet menu versions with the capability semver.
- **Element description** — the durable, serializable anchor for an element that must be findable after a reload (selector and text hints, obtained as a hydration facet). Deliberately *not* an ElementReference: descriptions are fuzzy and best-effort, resolved by whoever stored them.
  - The boundary rule: *handle for the living page → ElementReference; anchor that must survive reload → element description.*

## Annotations (feedback plugin)

Domain vocabulary owned by the feedback reference plugin and its `feedback.sink` capability — not the kernel.

- **Annotation** — a human-authored, route-scoped piece of feedback, optionally anchored to an element by an element description (never an ElementReference). Wire-legal by construction; the unit agents list and resolve.
- **Annotation lifecycle** — `draft` → `open` → `resolved`. Drafts are private working state that survive a reload; submission (draft → open) is the moment an annotation becomes visible to agents and eligible for egress; resolution requires a resolution note saying what was done.
- **Outbox** — the storage-held set of annotations awaiting action or egress. Working state, never a system of record: an annotation's durable home is wherever a sink puts it.
- **Sink** — the egress seam: a capability (`feedback.sink`) an application may provide to carry submitted annotations to an external system of record. Probed, never required — absent a sink, the loop still closes locally in the outbox.
- **Agent loop** — the flagship workflow the feedback plugin exists to prove: a human annotates, the submission surfaces to agents, an agent acts on the code, and resolution flows back to the human. Creation is human-only; the agent surface is read and resolve.
