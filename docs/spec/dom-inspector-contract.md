# Switchboard `dom.inspector` Capability Contract

**Version: `dom.inspector@1.0.0`.** The capability's semver **is** the contract version: a provider declares `provides: ["dom.inspector@1.0.0"]`, consumers pin ranges with `requires: ["dom.inspector@^1"]` ([kernel spec §10.1](./kernel-api.md#101-declarations)). The version is decoupled from any npm package version — the same posture as the `toolbar` capability. Everything in this document — the envelope, the registry semantics, the facet menu, the command surfaces — versions under this semver (§8).

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119.

TypeScript signatures and typed-JSON shape blocks in this document are **normative**. Prose qualifies them; it does not override them.

This is a **capability contract**: it binds whichever plugin provides the `dom.inspector` capability, and it is the one normative home for element identity in Switchboard. The kernel spec deliberately contains no DOM vocabulary ([kernel spec §1](./kernel-api.md#1-scope)); the cross-cutting rules this document leans on — the naming grammar, the permission vocabulary, and the wire-legal rule — live in [`kernel-api.md`](./kernel-api.md) and are cited, never restated; the words **named error** and **loud** are defined in [`diagnostics.md`](./diagnostics.md). Bridge exposure mechanics live in [`bridge-protocol.md`](./bridge-protocol.md). Related documents: [`toolbar-contract.md`](./toolbar-contract.md) (this document's structural twin), [`plugins/inspector.md`](./plugins/inspector.md) (the v1 reference provider's brief).

*Consolidates (non-normative): the resolutions of tickets #12 (element identity & serializable data contracts), #14 (reference plugin briefs — service-side `describe`), and #16 (assembly — the `dom.pick-element` dual outcome, resolving #13's flag).*

---

## 1. Scope

*Consolidates: #12, #16.*

The `dom.inspector` capability owns the vocabulary of **element identity**: what a reference to a live DOM element is, how references are minted and resolved, how element detail is fetched on demand (**hydration**), and how an element is anchored durably across reloads (**element descriptions**). Plugins that work with page elements — an a11y scanner scoping a scan, a feedback plugin anchoring an annotation — interoperate through this contract, not through ad-hoc selectors or shared node globals.

- The provider of `dom.inspector` MUST register a Service named `dom.inspector` (§4). By the capability convention ([kernel spec §10.1](./kernel-api.md#101-declarations)), the capability name coincides with the service name it promises.
- At most one installed plugin provides `dom.inspector` ([kernel spec §10.2](./kernel-api.md#102-single-provider)). This single-provider rule is what makes references **mutually resolvable**: every reference in a page was minted by the same registry, so a reference obtained from any plugin resolves through the same service for every other plugin.
- Element-anchored plugins acquire an honest dependency on the capability: `requires: ["dom.inspector@^1"]` for a hard dependency, or `services.tryGet("dom.inspector")` for a soft one ([kernel spec §9](./kernel-api.md#9-services)).
- All registered names in this contract (`dom.inspector`, `dom.describe-element`, `dom.pick-element`, `dom.selected-element`) follow the kernel name grammar ([kernel spec §2](./kernel-api.md#2-naming)).

Agent-facing behavior in this contract (§5.2, §6) additionally depends on the provider holding the relevant `bridge:*` grants ([kernel spec §12](./kernel-api.md#12-permissions)); exposure mechanics are the bridge protocol spec's affair. Nothing in this contract is a security boundary — v1 trusts plugin code ([kernel spec §1](./kernel-api.md#1-scope)).

## 2. ElementReference

*Consolidates: #12.*

An **ElementReference** is a registry-minted, opaque handle to a live DOM node *instance*, valid only within the page session that minted it.

### 2.1 Identity

- Identity is the node **instance**, not the logical element: if a framework remounts a component, the old node's reference goes stale and the new node gets a fresh identity. Heuristic "same logical element" re-binding is never performed on references — that job belongs exclusively to element descriptions (§7).
- References are **strictly live-session**: a reference is meaningful only to the registry that minted it, and only while that page session lives. Reference ids MUST NOT repeat across page sessions, so a reference carried over a reload can never silently resolve to the wrong node — it fails as stale (§3.2).
- `id` is an opaque string. Consumers MUST NOT parse it or attach meaning to its format.
- Minting the same live node again while it remains registered MUST yield the same `id`, so two references to one node are comparable by `id` equality.

### 2.2 The envelope

A reference travels as a **closed four-field display envelope**:

```ts
interface ElementReference {
  kind: 'element'   // brand discriminator — self-announcing in arbitrary payloads
  id: string        // registry-minted, opaque, unique within the page session
  tag: string       // mint-time snapshot: lowercase tag name
  label: string     // mint-time snapshot: short human-readable label
}
```

- `kind` is the brand that makes references recognizable inside arbitrary wire payloads (a violations list, a context value) without out-of-band knowledge.
- `tag` and `label` are **mint-time, display-only snapshots** — by contract they MAY be stale relative to the live node. They exist so element lists and agent narration need no hydration round-trip per element; anything load-bearing MUST come from hydration (§5). The provider SHOULD derive `label` from the element's accessible name or visible text, falling back to the tag name.
- The envelope is **closed**: providers MUST NOT add fields, and extra per-element data a plugin wants to ship travels *beside* the reference in that plugin's own payload, never inside it. This keeps the shape schema-stable across the capability's semver.
- Geometry is deliberately excluded from the envelope: it is volatile, and a snapshot in the envelope would invite trust in stale data. Geometry is a hydration facet (§5.1).

### 2.3 The shared schema definition

The envelope's JSON Schema is published as a reusable `$defs` entry that plugin schemas (command inputs and outputs, context value documentation) reference rather than redeclare:

```json
{
  "$defs": {
    "ElementReference": {
      "type": "object",
      "properties": {
        "kind": { "const": "element" },
        "id": { "type": "string" },
        "tag": { "type": "string" },
        "label": { "type": "string" }
      },
      "required": ["kind", "id", "tag", "label"],
      "additionalProperties": false
    }
  }
}
```

The envelope is wire-legal by construction and, like all Command/Event/Context data, is bound unconditionally by the wire-legal rule — see [kernel spec §14](./kernel-api.md#14-the-wire-legal-rule), the one normative home for that contract. The live `Element` node itself is never wire-legal; it crosses plugin boundaries only through the Service (§4).

## 3. The element registry

*Consolidates: #12.*

Behind every reference is the provider's **element registry**: the id → node map that mints and resolves references.

### 3.1 Non-pinning

The registry MUST NOT keep DOM alive: entries hold nodes weakly (id → `WeakRef`, with `FinalizationRegistry`-style pruning of collected entries). Minting a reference never extends a node's lifetime; garbage collection is the only collector.

Consequently there is **no `release()` API in v1** — consumers have nothing to free, and a leaked reference costs a registry entry, not a DOM subtree.

### 3.2 The single failure: `stale reference`

Resolution has exactly one failure mode, the **stale reference** error: the node has been collected, or the id is not known to this registry (never minted here, or minted in a previous page session).

The contract deliberately does not distinguish *unknown* from *expired*: WeakRef pruning makes the distinction unreliable exactly when it would matter, so a two-error vocabulary would be a lie. Providers MUST surface staleness as a single [named error](./diagnostics.md#3-named-errors-switchboarderror) — code `stale-reference` ([diagnostics spec §5.3](./diagnostics.md#53-capability-contract-codes)) — from `describe` (§4) and the describe command (§5.2), or as `null` (from `resolve`, §4) — never as a fabricated empty result.

### 3.3 Detachment is not death

An out-of-document node that is still GC-alive (e.g. held by a framework about to re-insert it) MUST still resolve and hydrate. Hydration reports `connected: false` (§5.2) and the consumer decides what detachment means for its use case. Only collection — or an unknown id — makes a reference stale.

## 4. The service

*Consolidates: #12, #14.*

The provider MUST register the `dom.inspector` service with this surface:

```ts
interface DomInspectorService {
  mint(el: Element): ElementReference
  resolve(ref: ElementReference): Element | null        // null = stale (§3.2)
  describe(ref: ElementReference, facets: Facet[]): Promise<DescribeResult>
}
```

- **`mint`** registers a live node (idempotently, §2.1) and returns its envelope. Minting MUST NOT pin the node (§3.1).
- **`resolve`** returns the live node, or `null` when the reference is stale. In-page consumers get the real `Element` — no serialized-bag ceremony where the bridge's constraints don't apply; the Service primitive is the sanctioned live-object channel ([kernel spec §9](./kernel-api.md#9-services), [§14.2](./kernel-api.md#142-binding)). A detached-but-alive node resolves normally (§3.3).
- **`describe`** is the in-page twin of the bridge describe command: same facet menu, same result shape, same semantics (§5.2), so in-page consumers hydrate without a bridge round-trip. A stale reference rejects with the stale-reference error.

`resolve` and `describe` accept references only — never element descriptions (§7); a description is not a handle and has no fast path back to a node.

## 5. Hydration and facets

*Consolidates: #12.*

**Hydration** is fetching element detail on demand instead of shipping it eagerly. Lazy hydration means *don't ship unasked-for data*, not *ship it in many trips*: one call fetches exactly the facets the caller wants, and the alternative — a fleet of narrow per-detail commands — is rejected because it would bloat the agent tool list.

### 5.1 The facet menu

The v1 facet menu is part of this contract; adding a facet is a minor version bump (§8).

```ts
type Facet = 'attributes' | 'geometry' | 'a11y' | 'description'

interface DescribeResult {
  connected: boolean                        // always present; false = detached but alive (§3.3)
  attributes?: Record<string, string>       // current DOM attributes, name → value
  geometry?: { x: number; y: number; width: number; height: number }
                                            // bounding box, viewport CSS px — a snapshot, instantly stale
  a11y?: { role: string | null; name: string | null }
                                            // computed role and accessible name
  description?: ElementDescription          // the durable anchor (§7)
}
```

- Each requested facet appears as the same-named key in the result; facets not requested MUST NOT be computed or returned.
- An empty `facets` array is legal and useful: the result is bare `{ connected }` — the cheapest liveness probe.
- The `a11y` facet MAY carry additional keys in later minor versions; consumers MUST tolerate unknown keys in facet payloads.
- `description` is the durable-description facet — how an element description (§7) is obtained, and how the feedback plugin obtains what it stores.

### 5.2 The describe command: `dom.describe-element`

The provider MUST register **one** faceted describe command, id `dom.describe-element` — the agent-side door to hydration:

- **Input:** `{ element: string, facets?: Facet[] }`, where `element` is a reference **id** (§2.1; agents copy it from an envelope they hold). `facets` defaults to `[]`.
- **Result:** `DescribeResult` (§5.1) in one round-trip.
- **Stale reference:** the whole command MUST fail with the stale-reference error — at the bridge this surfaces as an `isError` result naming the offender (see the bridge protocol spec). `connected: false` with facet data is the detached-but-alive case and is *not* an error.

The kernel and the bridge know nothing of hydration: `dom.describe-element` is an ordinary command whose schemas reference the `ElementReference` `$defs` shape (§2.3), exposed to agents under the ordinary `bridge:commands` grant.

## 6. The element picker: `dom.pick-element`

*Consolidates: #16 (resolving #13's flag); #14.*

The provider MUST register the picker command `dom.pick-element` — "ask the human to point at an element" — and the context key `dom.selected-element`. The picker is agent-invocable by design: agent invokes pick → human clicks → agent holds the envelope (and can read it back from `dom.selected-element`) → agent hydrates via `dom.describe-element`.

### 6.1 The dual outcome

A completed pick MUST do both of:

1. **Return** the result to its invoker (in-page `commands.execute` callers await it; agents receive it as the tool result), and
2. **Write** the picked envelope to the `dom.selected-element` context key,

so the await-the-result flow and the read-the-context flow are both normative. A pick that does not complete with a selection leaves `dom.selected-element` untouched.

### 6.2 The result union

```ts
type PickResult =
  | { picked: true; element: ElementReference }
  | { picked: false; reason: 'cancelled' | 'timeout' }
```

The result is this structured union, **never** an error result: a human declining to pick (`cancelled` — e.g. Esc) or letting the picker expire (`timeout`) is an *answer*, not a malfunction. `isError` stays reserved for real failures, so agent retry logic stays sane.

### 6.3 The deadline

The picker MUST enforce its own deadline, strictly shorter than the bridge's invoke timeout (60 s by default — see the bridge protocol spec), so an expiring pick arrives as `{ picked: false, reason: 'timeout' }` data rather than a transport-level timeout. The exact deadline is provider-chosen.

If the invocation is aborted by the caller (`invocation.signal`, [kernel spec §6](./kernel-api.md#6-commands)), the provider MUST dismantle the picker UI; the invocation then concludes under ordinary kernel/bridge cancellation semantics rather than through this union.

## 7. Element descriptions: the durable-anchor split

*Consolidates: #12.*

A reference is a handle for the living page; it does not survive a reload, by design. Anchoring an element *durably* is a different concept with different physics: an **element description** — fuzzy, best-effort re-location hints, obtained as the `description` facet (§5.1) and re-resolved after a reload by **whoever stored it**. The provider promises nothing about a description's future resolvability; re-location (e.g. the feedback plugin finding an annotation's element next session) is the storing consumer's best-effort affair.

```ts
interface ElementDescription {
  selector: string   // best-effort CSS selector, as specific as the DOM allowed at describe time
  tag: string        // tag name at describe time
  text?: string      // short visible-text sample, when the element had one
}
```

- Descriptions are wire-legal data, storable and shippable anywhere ordinary data goes.
- Later minor versions MAY add hint fields; consumers MUST tolerate unknown fields and SHOULD store descriptions whole, so richer hints survive round-tripping through stores that predate them.
- The two concepts are never conflated: `resolve`/`describe` never accept a description (§4), and a description never contains a reference id.

The boundary rule: *handle for the living page → ElementReference; anchor that must survive reload → element description.* Storing references is always a bug — they are guaranteed dead next session (§2.1).

## 8. Versioning

*Consolidates: #12, #16.*

The capability semver on the `provides` declaration is the only version this contract has; there is no separate document or protocol number.

- **Minor bump:** additive change a v1 consumer can ignore — a new facet (§5.1), new keys inside a facet payload, new `ElementDescription` hint fields, a new command.
- **Major bump:** any change to the closed envelope (§2.2), removing or reshaping a facet, changing the failure vocabulary (§3.2), or changing the picker union (§6.2).

Consumers SHOULD require `dom.inspector@^1` and rely only on what this document names; everything else observed about the reference provider is implementation detail with no compatibility promise.
