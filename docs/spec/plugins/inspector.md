# Reference Plugin Brief: DOM Inspector

**Brief, not contract.** This document describes the v1 reference plugin `reference.dom-inspector` at surface level. The normative material lives in the [`dom.inspector` capability contract](../dom-inspector-contract.md) — element identity, the registry, facets, the picker union are defined **there** and pointed at from here, never restated. This brief carries no version header: briefs describe plugins, contracts bind them. The one version that matters is the capability semver the plugin declares (§2).

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** in this document are to be interpreted as described in RFC 2119.

*Consolidates (non-normative): the resolutions of tickets #14 (reference plugin briefs), #12 (element identity), and #16 (assembly — picker dual outcome).*

---

## 1. Scope

*Consolidates: #14.*

The **infrastructure provider**: the v1 reference implementation of the `dom.inspector` capability. It ships:

- the `dom.inspector` Service — `mint` / `resolve` / `describe` ([contract §4](../dom-inspector-contract.md#4-the-service));
- an **element picker** — hover-highlight, click-to-select — behind the `dom.pick-element` command ([contract §6](../dom-inspector-contract.md#6-the-element-picker-dompick-element));
- the bridge-side hydration command `dom.describe-element` ([contract §5.2](../dom-inspector-contract.md#52-the-describe-command-domdescribe-element)).

**No panel.** The UI-heavy slot in the reference suite belongs to the a11y scanner ([`scanner.md`](./scanner.md)); the inspector's only UI is the transient picker overlay.

## 2. Manifest

*Consolidates: #14.*

```ts
definePlugin({
  id: 'reference.dom-inspector',
  name: 'DOM Inspector',
  version: '1.0.0',
  description: 'Element identity provider: references, hydration, picker',
  provides: ['dom.inspector@1.0.0'],
  permissions: ['bridge:commands', 'bridge:context', 'dom:read'],
  setup, // §3
})
```

- `provides: ['dom.inspector@1.0.0']` — the capability semver **is** the contract version ([contract §8](../dom-inspector-contract.md#8-versioning)); consumers pin `dom.inspector@^1`.
- The grant set is a partial bridge family: commands and context cross, no `bridge:events` (the plugin registers no events).
- `dom:read` is the advisory page-world permission honestly describing what an inspector does ([kernel spec §12.2](../kernel-api.md#122-the-v1-vocabulary--eight-strings)).

## 3. Registered surface

*Consolidates: #14.*

| Kind | Name | Defined in |
|---|---|---|
| Service | `dom.inspector` | [contract §4](../dom-inspector-contract.md#4-the-service) |
| Command | `dom.pick-element` | [contract §6](../dom-inspector-contract.md#6-the-element-picker-dompick-element) |
| Command | `dom.describe-element` | [contract §5.2](../dom-inspector-contract.md#52-the-describe-command-domdescribe-element) |
| Context | `dom.selected-element` | [contract §6.1](../dom-inspector-contract.md#61-the-dual-outcome) |

No events, no storage.

## 4. Toolbar contribution (soft)

*Consolidates: #14.*

The inspector probes for a toolbar with `services.tryGet('toolbar')` ([toolbar contract §2.3](../toolbar-contract.md#23-consumption)): when one is present it contributes a command item binding `dom.pick-element`; when none is, the service and commands work identically — the plugin is headless-safe. This is the suite's **tryGet-present** path (the feedback plugin exercises the absent path).

## 5. The picker deadline

*Consolidates: #16, #14.*

The contract requires a provider-chosen picker deadline strictly shorter than the bridge's 60 s invoke timeout ([contract §6.3](../dom-inspector-contract.md#63-the-deadline)). **The reference provider's deadline is 45 seconds** — comfortably under the bridge default, so an expiring pick always arrives as `{ picked: false, reason: 'timeout' }` data ([contract §6.2](../dom-inspector-contract.md#62-the-result-union)) rather than a transport-level timeout, and `isError` stays reserved for real failures.

## 6. The agent flow: "ask the human to point"

*Consolidates: #14.*

`dom.pick-element` is **agent-invocable by design**: agent invokes pick → human clicks an element → the result returns to the invoker *and* the envelope lands in `dom.selected-element` (the dual outcome, [contract §6.1](../dom-inspector-contract.md#61-the-dual-outcome)) → the agent hydrates exactly the facets it wants via `dom.describe-element`. One scenario exercising commands over the bridge, context over the bridge, ElementReference wire-legality, and faceted hydration.

## 7. Recorded constraint

*Consolidates: #14.*

`when` predicates read Context only ([kernel spec §11](../kernel-api.md#11-visibility-predicates-when)); v1 has **no per-surface visibility dimension** — a command cannot be listed for UI but hidden from agents, or vice versa. The reference suite demonstrates this is acceptable; the constraint is recorded here because the inspector (a plugin whose commands serve humans and agents differently) is where it would first pinch.

## 8. Coverage role

*Consolidates: #14.*

Validates, for the suite's coverage matrix ([index](../README.md)):

- capability **provision** with a contract-version semver ([kernel spec §10.1](../kernel-api.md#101-declarations));
- the **tryGet-present** consumption path;
- the non-pinning registry and the single `stale reference` failure ([contract §3](../dom-inspector-contract.md#3-the-element-registry));
- hydration facets **both** in-page (service `describe`) and over the bridge (`dom.describe-element`);
- ElementReference envelopes as wire-legal Context values and command results.
