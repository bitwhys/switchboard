# The agent feedback loop

This file covers the primary walkthrough for the feedback plugin: the end-to-end human → agent → human loop ([feedback brief §8](../spec/plugins/feedback.md#8-flagship-success-criterion-the-agent-loop)). It reuses models defined elsewhere: visibility is covered in [`exposure-model.md`](./exposure-model.md), and wire transport is covered in [`bridge-flows.md`](./bridge-flows.md).

## The loop

```mermaid
sequenceDiagram
    actor H as human
    participant F as feedback plugin
    participant I as inspector plugin
    participant K as kernel
    participant B as bridge
    actor A as agent
    H->>F: annotate this element (panel)
    F->>K: commands.execute('dom.pick-element')  — source: 'plugin'
    K->>I: dispatch
    H->>I: clicks an element
    I-->>F: PickResult returned ∙ AND written to dom.selected-element
    F->>I: dom.inspector service: describe(ref, ['description'])
    I-->>F: ElementDescription — the durable anchor
    F->>F: draft → storage outbox (survives reload)
    H->>F: submit
    F->>F: draft → open  — now agent-visible via feedback.list
    F->>K: emit feedback.submitted
    K->>B: forwarded (bridge:events) → tail buffer
    A->>B: switchboard.events.tail — sees the submission
    A->>B: feedback.list → fixes the code → feedback.resolve + note
    B->>K: invoke (bridge:commands) — source: 'agent'
    K->>F: dispatch feedback.resolve
    F->>F: open → resolved, in the outbox
    F->>K: context.set('feedback.open-count', n−1) — page-only
    Note over K: badge ticks down on the toolbar item
    H->>F: sees the resolution note in the panel
```

Step by step, with what each step demonstrates:

1. **A human picks an element.** The feedback plugin invokes `dom.pick-element` **cross-plugin** through `api.commands.execute`, arriving at the inspector with `invocation.source: 'plugin'` — in-page dispatch is a first-class path, not a bridge-only affair ([feedback brief §5](../spec/plugins/feedback.md#5-anchoring-rides-the-loose-route), [kernel §6.1](../spec/kernel-api.md#61-registration-and-dispatch)).
2. **The result arrives through two defined paths.** A completed pick both *returns* the result to its invoker and *writes* the envelope to the `dom.selected-element` context key. The contract defines this dual outcome so both consumption styles remain valid ([dom.inspector §6.1](../spec/dom-inspector-contract.md#61-the-dual-outcome)).
3. **Hydration goes through the Service, not the bridge.** The plugin fetches the `description` facet via the `dom.inspector` **service** — an in-page consumer hydrates without a round-trip ([dom.inspector §4](../spec/dom-inspector-contract.md#4-the-service)). It stores the element *description*, never an ElementReference: the anchor must survive a reload, and references are guaranteed dead next session ([dom.inspector §7](../spec/dom-inspector-contract.md#7-element-descriptions-the-durable-anchor-split)).
4. **The draft lands in the storage outbox** — private working state under `storage:use`, surviving reload, read defensively ([feedback brief §3](../spec/plugins/feedback.md#3-the-annotation-record), [kernel §13.4](../spec/kernel-api.md#134-durability-reachability-not-shape)).
5. **Submission moves it `draft → open`** — the moment the annotation becomes visible to agents (through `feedback.list`) and eligible for egress ([feedback brief §3](../spec/plugins/feedback.md#3-the-annotation-record)).
6. **`feedback.submitted` lands in the tail buffer** — the plugin holds `bridge:events`, so the emission is forwarded. This lets the agent loop react to submitted feedback through tail polling ([feedback brief §4](../spec/plugins/feedback.md#4-registered-surface), [bridge §9.2](../spec/bridge-protocol.md#92-the-tail-buffer)).
7. **The agent acts**: polls `switchboard.events.tail`, calls `feedback.list`, fixes the code, and calls `feedback.resolve` — which **requires a resolution note** saying what was done ([feedback brief §3](../spec/plugins/feedback.md#3-the-annotation-record)).
8. **Resolution flows back**: the outbox record moves to `resolved`, the panel shows the note, and `feedback.open-count` updates the badge ([feedback brief §7](../spec/plugins/feedback.md#7-toolbar-contribution), [toolbar §4.3](../spec/toolbar-contract.md#43-badges)). This key is page-only because feedback does not hold `bridge:context`: it exists in-page, drives the badge, and does not exist at the bridge. That boundary demonstrates that permission controls existence ([feedback brief §2](../spec/plugins/feedback.md#2-manifest), [bridge §3.3](../spec/bridge-protocol.md#33-permission--existence-when--listing)).

## What the loop deliberately does not allow

- **Creation is human-only.** The agent surface is read (`feedback.list`) and resolve (`feedback.resolve`) — nothing else. The shape is faster-fixes: humans point, agents fix ([feedback brief §1](../spec/plugins/feedback.md#1-scope)).
- **No egress ships in v1.** The `feedback.sink` capability seam is probed with `tryGet`, never required, and no v1 provider exists, so the loop closes locally without one. This remains a reserved extension seam for out-of-scope production egress work ([feedback brief §1](../spec/plugins/feedback.md#1-scope), [§9](../spec/plugins/feedback.md#9-coverage-role)).

## A note on `route`

Annotations are scoped to a `route: string` ([feedback brief §3](../spec/plugins/feedback.md#3-the-annotation-record)). No kernel, bridge, or contract vocabulary provides route awareness, so **route is plugin-local**: the feedback plugin defines how it determines the current route, including SPA navigation detection. No diagram in this directory implies a kernel route API, because none exists.
