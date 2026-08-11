# Reference Plugin Brief: Headless Metrics

**Brief, not contract.** This document describes the v1 reference plugin `reference.metrics` at surface level — scope, named ids, permissions, coverage role. It carries no version header: briefs describe plugins, contracts bind them. The manifest `version` field is informational ([kernel spec §3.1](../kernel-api.md#31-defineplugin-and-the-manifest)); nothing here versions independently of the kernel API.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** in this document are to be interpreted as described in RFC 2119.

*Background (not binding): the resolutions of tickets #14 (reference plugin briefs) and #13 (composition stress test, scenario 3).*

---

## 1. Scope

*Consolidates: #14.*

The pure producer: headless page-performance telemetry. The plugin observes Core Web Vitals (LCP, CLS, INP, TTFB) and long tasks via `PerformanceObserver`, and publishes them through the kernel. Nothing else:

- **No UI.** It contributes nothing to any toolbar and does not probe for one.
- **No commands, no services, no storage.** Its entire surface is Context and Events.
- **No capabilities** provided or required.

Custom app-instrumentation marks (user timing, product events) are out of scope — that is a product, not a reference.

## 2. Manifest

*Consolidates: #14.*

```ts
definePlugin({
  id: 'reference.metrics',
  name: 'Metrics',
  version: '1.0.0',
  description: 'Core Web Vitals and long-task telemetry',
  permissions: ['bridge:context', 'bridge:events'],
  setup, // §3
})
```

- The grant set is a deliberately partial bridge family: Context and Events cross the bridge, and with no `bridge:commands` the plugin simply has nothing that could exist at the bridge's tool surface ([bridge spec §3](../bridge-protocol.md#3-bridge-grants-mechanics)).
- The plugin id follows `publisher.name` ([kernel spec §2.3](../kernel-api.md#23-plugin-ids)); its registrations live under the `metrics.*` prefix by the ordinary convention ([kernel spec §2.4](../kernel-api.md#24-prefixes-and-the-reserved-namespace)) — the id and the prefix are distinct names on purpose.

## 3. Registered surface

*Consolidates: #14.*

| Kind | Name | Value |
|---|---|---|
| Context | `metrics.vitals.lcp` | latest LCP observation |
| Context | `metrics.vitals.cls` | latest cumulative CLS |
| Context | `metrics.vitals.inp` | latest INP observation |
| Context | `metrics.vitals.ttfb` | TTFB, once known |
| Event | `metrics.long-task` | one announcement per observed long task |

- Vitals are per-vital keys, not one blob: whole-value replace ([kernel spec §8.2](../kernel-api.md#82-whole-value-replace)) stays cheap and observers subscribe narrowly to exactly the vital they care about.
- Values and payloads MUST be plain JSON ([kernel spec §14](../kernel-api.md#14-the-plain-json-rule)) — plain numbers and small plain objects.
- A long task is a *moment*, not a state — the Event side of the boundary rule ([kernel spec §8](../kernel-api.md#8-context)) in its most natural habitat. The latest value of each vital is *what is true right now* — the Context side.

## 4. Agent surface

*Consolidates: #14.*

The plugin registers no commands, yet is fully agent-legible: agents read the vitals through `switchboard.context.read` and observe long tasks through `switchboard.events.tail` ([bridge spec §11](../bridge-protocol.md#11-built-in-tools)). A command-less, UI-less plugin is a first-class citizen — that demonstration is this plugin's reason to exist.

## 5. Coverage role

*Consolidates: #14, #13.*

Validates, for the suite's coverage matrix ([index](../README.md)):

- a command-less, UI-less plugin as a first-class citizen;
- a partial bridge grant family (`bridge:context` + `bridge:events`, no commands);
- Context sync replay to late observers ([kernel spec §8.1](../kernel-api.md#81-replay-on-observe));
- Events reaching the tail buffer ([bridge spec §9.2](../bridge-protocol.md#92-the-tail-buffer));
- the Context/Event boundary rule in its most natural habitat.

**Composition evidence** ([stress test, scenario 3](../../../prototypes/primitive-stress-test/README.md)): a hypothetical third-party plugin (`acme.perf-coach`) gating a command's `when` on long-task pressure cannot read Events, because `when` reads Context only ([kernel spec §11.1](../kernel-api.md#111-the-tracked-read-context-view)) — and must own its reduce-into-Context. That strain was examined and accepted: reduction semantics are domain logic, and Event ephemerality matters.
