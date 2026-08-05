# Switchboard — Domain Glossary

The ubiquitous language for Switchboard, an open-source, pluggable in-application developer tool runtime. Terms only — implementation detail lives in the spec suite and ADRs.

## Kernel & plugins

- **Kernel** — the framework-agnostic runtime (`core`) that hosts plugins and owns the four primitives' registries. Has no domain vocabulary of its own and never imports UI frameworks.
- **Plugin** — a unit of trusted code installed by the application developer, packaged as a single definition object: a static **Manifest** plus an imperative `setup` entry point. Identified by a **Plugin id** (`publisher.name`).
- **Manifest** — the static, statically-extractable half of a plugin: identity, its **capability** declarations (`provides`/`requires`), its **permissions**, and its **activation hints**. Readable without executing code; its schema (and the permission vocabulary) versions with the kernel API — there is no separate manifest version.
- **Permission** — a manifest-declared claim (`area:action`) naming a surface the kernel or bridge can gate. Every permission carries an **enforcement status**: *enforced* (the kernel/bridge honors it today — the `bridge:*` family) or *advisory* (descriptive in v1, gateable under future sandboxing — the page-world family). Unknown permission strings are carried but grant nothing.
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

## Capabilities

- **Capability** — an opaque named claim a plugin `provides` or `requires`, optionally versioned. By convention a capability name coincides with the service or context key it promises.
- **Checked, not solved** — Switchboard's capability posture: a flat presence-and-version check with loud named errors; no dependency resolver, no activation reordering. At most one installed provider per capability name.

## Surfaces & the bridge

- **Bridge** — the translation layer between the page kernel and out-of-page agents; speaks Switchboard's own versioned wire protocol page-side and MCP at the agent-facing edge.
- **Visibility predicate** (`when`) — a pure function over Context deciding whether a command is *listed* (in UI surfaces and the agent tool list). Gates listing, never dispatch, and is never a security boundary.
- **Behavioral hints** (annotations) — MCP-shaped, untrusted advisories on a command (read-only, destructive, idempotent). Hints for UX and agent policy, never enforcement.
- **Bridge grant** — a `bridge:*` permission. Default-closed and all-or-nothing per primitive family: without the grant a plugin's registrations don't exist at the bridge (not listed, not dispatchable). Attribution is by *act*: the bridge forwards what a granted plugin registered, emitted, or wrote — never by name ownership.
- **Reserved namespace** — `switchboard.*` names belong to the kernel itself; no plugin, including first-party reference plugins, may register there.

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
