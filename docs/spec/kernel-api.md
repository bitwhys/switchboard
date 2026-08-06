# Switchboard Kernel API Specification

**Version: Kernel API v1.** The manifest schema and the permission vocabulary are part of this contract and version with it; there is no separate manifest or permission version.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119.

TypeScript signatures and typed-JSON shape blocks in this document are **normative**. Prose qualifies them; it does not override them.

This document is the one normative home for three cross-cutting rules: the **naming grammar** (§2), the **permission vocabulary** (§12), and the **wire-legal rule** (§14). Every other document in the spec suite cites these sections by link and MUST NOT paraphrase them. Related documents: [`bridge-protocol.md`](./bridge-protocol.md) (what the bridge does about these contracts), [`toolbar-contract.md`](./toolbar-contract.md), [`dom-inspector-contract.md`](./dom-inspector-contract.md).

*Consolidates (non-normative): the resolutions of tickets #5, #6, #8, #12, #16 and the schema-authoring research ([`docs/research/schema-authoring-for-commands.md`](../research/schema-authoring-for-commands.md)).*

---

## 1. Scope

The kernel (`core`) is the framework-agnostic runtime that hosts plugins and owns the registries of the four primitives — Command, Event, Context, and Service — plus two pieces of kernel infrastructure: Disposable-based teardown and Storage. The kernel has no domain vocabulary of its own and MUST NOT import UI frameworks.

Out of scope here, by the one-normative-home rule: bridge exposure mechanics and the wire-legal enforcement point (bridge protocol spec), toolbar placement (`toolbar` capability contract), and element identity (`dom.inspector` capability contract). Capability-owned vocabulary lives in the owning capability's contract, never in this spec.

v1 trusts plugin code. Plugins are installed by the application developer; nothing in this specification is a security boundary against a malicious plugin.

*Consolidates: #5, #16.*

## 2. Naming

*Consolidates: #5, #6.*

### 2.1 The name grammar

One grammar covers every registerable name:

- A name is one or more segments separated by `.` (dots).
- Each segment matches `[a-z0-9-]+` (lowercase kebab; hyphens join words).
- Total length MUST be ≤ 128 characters.

Dots express hierarchy; hyphens join words; `@` appears only as the capability version separator (§10.1) and is not part of any name. The grammar is strictly within MCP's tool-name character set, so names pass to the bridge verbatim, never sanitized.

The kernel MUST validate every name at registration with one shared validator and reject violations with a loud error.

### 2.2 Name kinds

Six name kinds share the grammar. Four are **exclusive** — registering a taken name is a loud error:

- command ids
- service names
- capability names
- plugin ids

Two are **open channels** — many plugins may emit or write to the same name:

- event names
- context keys

### 2.3 Plugin ids

Plugin ids SHOULD be two segments, `publisher.name` (e.g. `acme.perf-panel`). The npm package name is unrepresentable in this grammar and lives in the manifest's `package` field (§3.1) instead.

### 2.4 Prefixes and the reserved namespace

A plugin's registrations live under its chosen namespace **by convention**; the kernel MUST NOT enforce prefix ownership — with one exception: **`switchboard.*` is reserved for the kernel itself.** Any plugin registration under `switchboard.*` MUST be rejected with a loud error. First-party reference plugins are not exempt (they use `metrics.*`, `dom.*`, `a11y.*`, `feedback.*`).

### 2.5 The colon grammar (permissions and activation hints)

Permission strings and activation hints use a **separate** colon grammar (§12.1): segments joined by `:`, deliberately outside the dot grammar so permissions and registerable names are distinguishable at a glance and can never collide at the bridge.

## 3. Plugin definition

*Consolidates: #5, #6.*

### 3.1 `definePlugin` and the manifest

A plugin is a single definition object: a static manifest plus an imperative entry point.

```ts
interface PluginDefinition {
  // ── manifest (static) ──────────────────────────────────────────
  id: string                 // REQUIRED. Plugin id, publisher.name grammar (§2.3)
  name: string               // REQUIRED. Human-readable display name
  version: string            // REQUIRED. Semver. Informational only (inspector
                             // display, bug reports); compatibility work stays
                             // on capability versions (§10)
  description?: string       // one-liner for pickers, inspector, agent surfaces
  package?: string           // npm package name; absent for single-file plugins
  permissions?: string[]     // permission strings (§12)
  activation?: string[]      // activation hints (§4.1)
  provides?: string[]        // capability declarations (§10.1)
  requires?: string[]        // capability requirements (§10.1)

  // ── entry point (imperative) ───────────────────────────────────
  setup(api: PluginApi): void | Promise<void>
}

declare function definePlugin(definition: PluginDefinition): PluginDefinition
```

There is no `manifestVersion` field and MUST NOT be one: the manifest schema — permission vocabulary included — is kernel API surface and versions with it.

The manifest deliberately excludes `icon`, `homepage`, `repository`, `author`, `license`, `engines`-style kernel-compatibility ranges, and any `contributes`-style declarative registration block. Registration is imperative, through `PluginApi` only.

### 3.2 Static extractability ("literals only")

Manifest fields — in particular `id`, `provides`, and `requires` — MUST be written as literals so the manifest is readable without executing code. This is a conformance rule for authors, checked by tooling or lint; the kernel cannot and does not detect computed strings at runtime.

### 3.3 Manifest validation

Malformed manifests MUST be rejected loudly: missing required fields (`id`, `name`, `version`, `setup`), an `id` violating the name grammar, a non-semver `version`, or `provides`/`requires`/`permissions`/`activation` entries violating their grammars. A manifest error blocks **that plugin only**; other plugins proceed.

Unknown manifest **fields** MUST be tolerated: preserved verbatim, surfaced as a dev-mode warning, never an error. See §15 for the full forward-compatibility posture.

## 4. Activation and lifecycle

*Consolidates: #5, #6.*

### 4.1 Activation hints

`activation?: string[]` lists additive wake conditions — any one suffices to wake the plugin. Hints use the colon grammar (§12.1). The v1 vocabulary is exactly one word: **`eager`**, which is also the default when the field is omitted. Unknown hints MUST be behaviorally ignored with a dev-mode warning.

(The lazy-trigger vocabulary is deliberately not designed in v1; this field is the seam it will occupy, since with imperative registration future lazy activation must be driven entirely by manifest pre-declaration.)

### 4.2 Activation

**Activation** is the moment the kernel checks a plugin's required capabilities (§10.3) and, if satisfied, runs its `setup`. Activation order is owned by the application developer; the kernel MUST NOT reorder plugins. A failed capability check or a throwing `setup` blocks **that plugin only**.

`setup` MAY be async; the kernel always awaits it as a Promise.

### 4.3 Teardown: Disposable

```ts
interface Disposable {
  dispose(): void
}
```

Every registration call (`commands.register`, `events.on`, `context.observe`, `services.register`) returns a `Disposable`, and the kernel **also tracks every Disposable it hands out**: on plugin deactivation the kernel disposes everything it can see, so a plugin that never thinks about cleanup is still fully cleaned up. There is no returned-cleanup-function convention.

`api.onDispose(fn)` registers teardown for effects the kernel cannot see (timers, DOM listeners, external subscriptions).

Deactivation does **not** auto-delete the plugin's context keys (§8.4).

## 5. PluginApi

*Consolidates: #5, #8.*

`setup` receives the plugin's only door into the kernel, grouped by primitive plus kernel infrastructure:

```ts
interface PluginApi {
  commands: CommandsApi   // §6
  events: EventsApi       // §7
  context: ContextApi     // §8
  services: ServicesApi   // §9
  storage: StorageArea    // §13 — kernel infrastructure, not a fifth primitive
  onDispose(fn: () => void): void
}
```

Terminology rule: the word **Context** belongs exclusively to the primitive. The setup parameter is `api`, typed `PluginApi` — never "PluginContext".

## 6. Commands

*Consolidates: #5; schema posture from #3.*

A **Command** is a named, invocable operation: one structured input in, serializable data out. Commands are the unit agents invoke as MCP tools.

```ts
interface CommandsApi {
  register(command: CommandDefinition): Disposable
  execute(id: string, input?: object): Promise<unknown>
}

interface CommandDefinition {
  id: string                       // name grammar (§2.1); MCP-legal by construction
  title: string
  description?: string
  inputSchema?: object             // plain JSON Schema, draft 2020-12 (§6.2)
  outputSchema?: object            // plain JSON Schema, draft 2020-12 (§6.2)
  validate?: StandardSchemaValidate // §6.3
  annotations?: object             // MCP ToolAnnotations, carried verbatim (§6.4)
  when?: (ctx: ContextView) => boolean  // visibility predicate (§11)
  execute(input: object, invocation: Invocation): unknown | Promise<unknown>
}

interface Invocation {
  source: 'ui' | 'agent' | 'plugin'
  signal: AbortSignal
}
```

### 6.1 Registration and dispatch

- Command ids MUST satisfy the name grammar (§2.1) — which keeps them within MCP's `[A-Za-z0-9_.-]`, ≤ 128 chars — and MUST be unique (exclusive kind, §2.2). Violations are loud registration errors. Ids pass to the bridge verbatim as tool names; the bridge never sanitizes.
- `execute` takes a single structured input object (mirroring MCP `tools/call`) and returns a JSON-safe value (wire-legal, §14). The handler MAY be sync or async; callers always receive a Promise.
- The handler is named `execute` for shape-compatibility with W3C WebMCP `ModelContext.registerTool` and vocabulary symmetry with `commands.execute`.
- Errors thrown by the handler become structured invocation errors wrapped with the command id. (At the bridge these map to MCP `isError: true` results — see the bridge protocol spec.)

### 6.2 Schemas

The kernel depends on **no schema library**. `inputSchema` and `outputSchema` are plain JSON Schema objects, target dialect **draft 2020-12** (MCP's default; no `$schema` field required), carried verbatim to the bridge.

Authors MAY produce these objects however they like; the blessed paths are: any Standard-Schema library with JSON Schema emission (Zod ≥ 4.2 is the recommended default) via the first-party `fromStandardSchema()` helper, TypeBox (whose types are already JSON Schema objects), or hand-written JSON Schema. See the schema-authoring research for evidence.

Declaring `outputSchema` is a conformance promise by the plugin. Its enforcement point is the bridge edge, not pre-dispatch — see the bridge protocol spec.

### 6.3 Validation

`validate`, when present, is a Standard-Schema-shaped function run **pre-dispatch** by the kernel:

```ts
type StandardSchemaValidate = (input: unknown) =>
  | { value: unknown }
  | { issues: { message: string; path?: (string | number)[] }[] }
```

If `validate` returns issues, the kernel MUST NOT run `execute` and MUST return the issues as a structured error to the caller. If `validate` is absent, the kernel dispatches unvalidated.

### 6.4 Annotations

`annotations` is an MCP `ToolAnnotations`-shaped object carried **verbatim**. Annotations are untrusted behavioral hints for UX and agent policy — never enforcement, never a security boundary. (The bridge defaults `openWorldHint: false`; see the bridge protocol spec.)

## 7. Events

*Consolidates: #5.*

An **Event** is a named, fire-and-forget announcement that something *happened*.

```ts
interface EventsApi {
  emit(name: string, payload?: unknown): void
  on(name: string, cb: (payload: unknown, meta: EmitMeta) => void): Disposable
}

interface EmitMeta {
  source: string      // emitting plugin id
  timestamp: number
}
```

- Events are **strictly ephemeral: no replay, no buffering, ever.** A late subscriber missed it. Replay has exactly one home — Context (§8). The boundary rule: *need the latest value later → Context; only announcing a moment → Event.*
- Payloads MUST be wire-legal (§14).
- Event names are an open channel (§2.2); emission is unrestricted and namespace ownership is by convention.
- There are no wildcard subscriptions in v1.

## 8. Context

*Consolidates: #5.*

A **Context** entry is a named, observable *value* — the home of "what is true right now."

```ts
interface ContextApi {
  set(key: string, value: unknown): void
  get(key: string): unknown | undefined
  delete(key: string): void
  observe(key: string, cb: (value: unknown, meta: EmitMeta) => void): Disposable
}
```

### 8.1 Replay on observe

`observe` MUST fire **synchronously on subscribe with the current value — including `undefined` if the key was never set** — and then on every subsequent `set`. An observer's callback is its complete rendering logic.

### 8.2 Whole-value replace

Values are wire-legal (§14) and **replaced whole** — there is no patch API in v1. Mutating an object after passing it to `set` (or after receiving it in a callback) is undefined behavior.

### 8.3 Notification semantics

Every `set` notifies observers; the kernel performs **no equality dedup** (observers dedup if they care). `delete(key)` notifies observers with `undefined`.

### 8.4 Ownership and cleanup

Context keys are an open channel (§2.2); writes are unrestricted in v1 and ownership is by convention. A disposed plugin's keys are **not** auto-deleted — some values legitimately outlive their writer; a writer that wants cleanup does it in `onDispose`.

## 9. Services

*Consolidates: #5.*

A **Service** is a named, live in-page JS value shared between plugins — the only primitive that is never serialized and never bridged (its defining semantic).

```ts
interface ServicesApi {
  register(name: string, service: unknown): Disposable
  get(name: string): Promise<unknown>
  tryGet(name: string): unknown | undefined
}
```

- Service names are exclusive (§2.2): duplicate registration is a loud named error. Disposal unregisters.
- `await services.get(name)` resolves the moment the provider registers — activation-order-insensitive without a resolver. It MUST reject **immediately** with a loud named error when no installed plugin `provides` the corresponding capability (it never hangs; the capability check guarantees this). If the provider's own `setup` fails, pending `get`s reject with that failure.
- `tryGet(name)` returns the current value or `undefined`, synchronously, for soft dependencies — no `requires` entry needed.

## 10. Capabilities

*Consolidates: #5.*

Switchboard's capability posture is **checked, not solved**: a flat presence-and-version check with loud named errors. No dependency resolver, no activation reordering, no graph.

### 10.1 Declarations

A capability is an opaque named claim. Entries in `provides` are `name` or `name@version` (exact semver); entries in `requires` are `name` or `name@range` (semver range). A bare name means "any version." Names follow the name grammar (§2.1); `@` is the version separator only. The kernel never parses meaning from capability names; by convention a capability name coincides with the service or context key it promises.

### 10.2 Single provider

**At most one installed plugin may provide a given capability name.** A duplicate `provides` is a loud activation error. This structurally eliminates provider choice, transitive conflicts, and any drift toward a solver.

### 10.3 The check

Once per plugin, at activation, before its `setup`: every `requires` entry must be satisfied by some installed plugin's `provides` (name present; if a range is given, `satisfies(range, version)` must hold). Failure blocks **that plugin only**. There is no runtime re-check when a provider is disposed (v1, trusted code, documented limitation).

Diagnostic errors MUST name the requiring plugin, the required string, and every near-miss with versions, e.g.:

> `docs-panel` requires `markdown.renderer@^1`; `switchboard.markdown` provides `markdown.renderer@2.0.0` (range not satisfied); no other providers installed.

### 10.4 Manifest-drift warning

The kernel SHOULD emit a dev-mode warning when a registered service name appears in no plugin's `provides` entry.

## 11. Visibility predicates (`when`)

*Consolidates: #5, #16.*

`when: (ctx: ContextView) => boolean` is a plain, pure function over a read-only Context view — no DSL.

### 11.1 The tracked-read Context view

```ts
interface ContextView {
  get(key: string): unknown | undefined   // latest value, synchronously
}
```

`ctx.get(key)` returns the latest value for `key` synchronously (`undefined` if unset). The kernel records which keys each evaluation **actually reads** and re-evaluates the predicate only when one of those keys changes, re-tracking on every run. Dependencies cannot drift from the code because they *are* the code — there is no declared dependency list, and there is no full-snapshot form.

Predicates MUST be pure and cheap: no side effects, no async, no reads outside the view.

### 11.2 Gates listing, never dispatch

A when-false command vanishes from UI surfaces and from the agent tool list, but direct `commands.execute()` MUST still work. Visibility is presentation, never a security boundary. (Bridge listing semantics — granted ∧ when-true — live in the bridge protocol spec.)

The `when` contract is defined on commands and reused verbatim by toolbar items (see the toolbar contract). There is no separate `enabledWhen` in v1.

## 12. Permissions

*Consolidates: #6, #8.*

This section is the one normative home for the permission vocabulary. Bridge-grant *mechanics* — existence-at-the-bridge, act-based attribution, the exposure summary — are the bridge protocol spec's obligation.

### 12.1 Grammar

A permission string is **`area:action`** — exactly two segments in v1, colon-separated, each a lowercase kebab word (`[a-z0-9-]+`). A third **qualifier** segment is reserved for future scoping (e.g. `network:observe:<name>`); qualifier segments MAY be full kebab-dot names. v1 defines no qualified permissions and no wildcards.

The governing rule: **every permission string must name a surface the kernel or bridge could actually gate** — an interceptable choke point. `area` names the surface, `action` the mode of access. Nothing aspirational gets a string. One validator, loud errors on malformed strings.

### 12.2 The v1 vocabulary — eight strings

Every permission carries an explicit **enforcement status**. Flipping advisory → enforced later is a kernel API semver event, not a schema break.

| Permission | Status | Claim |
|---|---|---|
| `bridge:commands` | **enforced** | commands may be exposed to agents as MCP tools |
| `bridge:context` | **enforced** | context writes may be observed by agents |
| `bridge:events` | **enforced** | events may be forwarded to agents |
| `storage:use` | **enforced** | may use its per-plugin storage area (§13) |
| `dom:read` | advisory | reads the host page's DOM |
| `dom:write` | advisory | mutates the host page's DOM |
| `network:observe` | advisory | observes the page's network traffic |
| `network:request` | advisory | issues its own network requests |

The `bridge:*` family is **default-closed and all-or-nothing per family per plugin**; permission = *existence* at the bridge, `when` = *listing* (§11.2). The advisory family is the future sandboxing seam: descriptive in v1, gateable later.

An **unknown** permission string is tolerated (dev-mode warning, carried verbatim) and **grants nothing** — the kernel and bridge honor only strings they know, so unknown is fail-safe in both directions. A **malformed** string is loudly rejected (§3.3).

There are no registry permissions (`commands:register` etc.) — registering primitives is what a plugin *is* — and no `bridge:storage` (§13.6).

## 13. Storage

*Consolidates: #8.*

Storage is **kernel infrastructure, not a fifth primitive**: nothing is registered, listed, or `when`-gated, and storage never crosses the bridge. "The four primitives" stays four.

### 13.1 The storage area

`api.storage` is the plugin's **storage area**: an async, JSON-valued key-value façade bound invisibly to the plugin's id.

```ts
interface StorageArea {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>   // JSON-serializable values only
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}
```

Fully async (the only shape every candidate engine can honor); no sync reads — "what is true right now" already has a sync home in Context. No queries, transactions, or watch/subscribe in v1. Values MUST be JSON-serializable (the same constraint as wire-legal data, §14).

### 13.2 Namespacing

There is no namespace parameter anywhere in the plugin-facing API: a plugin cannot name a namespace, so it cannot escape one. The engine receives the namespace (the plugin id) explicitly; physical isolation is the engine's job. **There is no cross-plugin storage access, by construction** — shared persistent state is a Service. `switchboard.*` remains reserved for the kernel's own persisted state.

### 13.3 Engines

The application developer passes a **storage engine** at kernel construction (`createSwitchboard({ storage: engine })`) — one engine per kernel instance, never chosen by or visible to plugins. The engine interface is **public API**; third parties can ship engines without kernel changes.

v1 `core` ships exactly two engines:

- **`localStorageEngine`** — the default. Key-prefixed (`switchboard:<plugin-id>:<key>`), async façade over sync calls.
- **`memoryEngine`** — Map-backed, non-durable: tests, SSR/non-DOM environments, explicit no-persistence — and the automatic fallback when `localStorage` throws, so `api.storage` never hard-fails (worst case it degrades to session lifetime).

### 13.4 Durability: reachability, not shape

The kernel guarantees **namespace reachability**: the plugin-id → physical-namespace mapping and key format are stable across kernel upgrades. That is the kernel's entire durability promise.

Value **shape** is plugin-owned under the **defensive read** convention: storage is untrusted input — validate on read, discard or default on mismatch. There are no kernel migration hooks in v1; a plugin wanting migrations stores its own version key and migrates lazily on first read.

### 13.5 Permission: `storage:use`

`storage:use` (§12.2) is **enforced and default-closed**: without the grant, `api.storage` is present (no shape surprises) but every call MUST reject loudly with a named error naming the missing permission. There is deliberately no `storage:read`/`storage:write` pair — namespacing means a plugin can only read what it wrote, so a read-only grant is incoherent.

### 13.6 Storage never bridges

No `bridge:storage` permission exists or is reserved. Agents never see stored bytes; a plugin that wants stored data agent-visible publishes it deliberately through the existing doors — a Command that returns it or a Context key that mirrors it — governed by the ordinary bridge grants.

The boundary rule: *state that must survive a reload → storage; state others must see → egress (bridge or network), never storage — Switchboard is not a system of record.*

## 14. The wire-legal rule

*Consolidates: #12.*

This section is the one normative home for the serializability contract. Its **enforcement point** is the bridge — see the bridge protocol spec; the kernel never deep-inspects payloads.

### 14.1 Definition

A value is **wire-legal** iff it survives `JSON.parse(JSON.stringify(x))` unchanged: objects, arrays, strings, finite numbers, booleans, `null`. Not wire-legal: `Date`, `Uint8Array` (and all binary), `Map`/`Set`, cycles, functions, and meaningful `undefined`. Timestamps travel as numbers or ISO strings under the plugin's own schema; binary is out of scope for v1.

### 14.2 Binding

The rule binds **all three bridgeable primitives unconditionally** — Command inputs and results, Event payloads, and Context values MUST be wire-legal whether or not any `bridge:*` grant is held. (Otherwise adding a grant later would break the plugin's own data.) Bridge grants never change the contract.

The boundary rule: *live object → Service; data → everything else, and data means strict JSON.*

There are no payload size caps in v1; "keep payloads small" is prose guidance.

## 15. Versioning and forward compatibility

*Consolidates: #6.*

Two version numbers exist in Switchboard: the **kernel API version** (this document; semver on the `core` package) and the **bridge protocol version** (a plain integer; see the bridge protocol spec). Capability contracts carry their own semvers on the capability name (§10.1) and version independently.

The manifest schema, activation-hint vocabulary, and permission vocabulary are kernel API surface: additions and enforcement-status changes land as kernel API semver events.

The uniform posture, applied throughout this spec:

- **Unknown = tolerated.** Unknown manifest fields, permission strings, and activation hints: dev-mode warning, preserved/carried verbatim, never an error, never a grant.
- **Malformed = rejected loudly**, blocking that plugin only.

Shaped-to-be-additive future work (deliberately not v1): per-registration `bridged: false` opt-outs, wildcard and qualified permissions, the lazy-activation trigger vocabulary, an IndexedDB storage engine, and binary payload support.
