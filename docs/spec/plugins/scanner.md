# Reference Plugin Brief: Accessibility Scanner

**Brief, not contract.** This document describes the v1 reference plugin `reference.a11y-scanner` at surface level — scope, named ids, permissions, contributions, coverage role. It carries no version header: briefs describe plugins, contracts bind them.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** in this document are to be interpreted as described in RFC 2119.

*Background (not binding): the resolutions of tickets #14 (reference plugin briefs) and #13 (composition stress test, scenario 1).*

---

## 1. Scope

*Consolidates: #14.*

The **UI-heavy consumer**: on-demand accessibility scans powered by [axe-core](https://github.com/dequelabs/axe-core), page-wide or scoped to the subtree of an optional ElementReference. Wrapping a real npm dependency is part of the point — reference plugins are ordinary packages, not privileged kernel residents.

**Out of scope:** continuous or `MutationObserver`-driven scanning. Scans run when asked — from the strip, from the panel, or from an agent.

## 2. Manifest

*Consolidates: #14.*

```ts
definePlugin({
  id: 'reference.a11y-scanner',
  name: 'Accessibility Scanner',
  version: '1.0.0',
  description: 'On-demand axe-core scans with element-anchored violations',
  requires: ['toolbar@^1', 'dom.inspector@^1'],
  permissions: [
    'bridge:commands', 'bridge:context', 'bridge:events',
    'dom:read', 'dom:write',
  ],
  setup, // §3
})
```

- **Hard requires**, both: without a toolbar or an inspector the plugin fails activation loudly ([kernel spec §10.3](../kernel-api.md#103-the-check)). The scanner is the suite's honest-hard-dependency case — a violations UI without a panel, or element-anchored violations without a registry, would be a lie.
- The grant set is the **full bridge family** — all three `bridge:*` strings — plus both in-page advisories: `dom:read` for scanning, `dom:write` for the jump-to-element scroll/flash highlight.

## 3. Registered surface

*Consolidates: #14.*

| Kind | Name | Notes |
|---|---|---|
| Command | `a11y.scan` | optional ElementReference input scoping the scan; annotated read-only ([kernel spec §6.4](../kernel-api.md#64-annotations)) |
| Context | `a11y.violations` | whole value per scan: violations carrying ElementReference envelopes minted via the inspector, plus rule id, impact, and help text — all plain JSON |
| Context | `a11y.violation-count` | current violation count; feeds the strip badge (§4) |
| Event | `a11y.scan-completed` | summary only (counts, scope) |

- `a11y.scan` taking an **ElementReference as command input** is the round-trip direction nothing else in the suite exercises: agent obtains a reference (e.g. via the picker), hands it back, the scanner resolves it in-page through the inspector service.
- `a11y.violation-count` exists because the badge value mapping requires a number or boolean ([toolbar contract §4.3](../toolbar-contract.md#43-badges)); it is derived from `a11y.violations` and written in the same breath.
- `a11y.scan-completed` is the **loose-coupling point**: downstream plugins observe it without any dependency on the scanner (the feedback plugin drafts annotations from it — [`feedback.md`](./feedback.md) §6), and it is tail-buffer-visible ([bridge spec §9.2](../bridge-protocol.md#92-the-tail-buffer)) so agents notice scans they didn't trigger.

## 4. Toolbar contribution

*Consolidates: #14.*

Via the required `toolbar` service ([toolbar contract §3](../toolbar-contract.md#3-the-toolbar-service)):

- **Panel** — id `a11y.panel`, title "Accessibility": the violations list; each entry offers jump-to-element (inspector `resolve` + scroll and flash — the `dom:write` act). Mounted per the mount contract ([toolbar contract §5.2](../toolbar-contract.md#52-the-mount-contract)); surviving state lives in Context, never the mounted DOM.
- **Command item** — binds `a11y.scan`, with `badge: { context: 'a11y.violation-count' }` rendering the current count.

## 5. Coverage role

*Consolidates: #14, #13.*

Validates, for the suite's coverage matrix ([index](../README.md)):

- hard capability requires with loud activation failure;
- the panel mount contract and adapter-owned chrome ([toolbar contract §5, §7](../toolbar-contract.md#5-panels-and-the-mount-contract));
- the badge, count-valued;
- **ElementReference as command input** (the only suite exerciser of that direction);
- the full `bridge:*` grant set on one plugin;
- a real third-party npm dependency inside a plugin.

**Composition evidence** ([stress test, scenario 1](../../../prototypes/primitive-stress-test/README.md)): the scanner ⇄ inspector ⇄ feedback chain — agent-supplied reference hydrated via the service, axe on the subtree, violations into Context, summary Event, feedback drafting annotations from violations — service call, command, event, context, and storage in one flow, with no fifth primitive needed.
