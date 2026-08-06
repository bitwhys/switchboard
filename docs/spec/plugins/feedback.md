# Reference Plugin Brief: Feedback & Annotations

**Brief, not contract.** This document describes the v1 reference plugin `reference.feedback` — the suite's **flagship** — at surface level. It carries no version header: briefs describe plugins, contracts bind them. Domain vocabulary (annotation, lifecycle, outbox, sink, agent loop) lives in the glossary (`CONTEXT.md`, "Annotations").

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** in this document are to be interpreted as described in RFC 2119.

*Consolidates (non-normative): the resolutions of tickets #14 (reference plugin briefs), #12 (element descriptions), and #13 (composition stress test, scenarios 1–2).*

---

## 1. Scope

*Consolidates: #14.*

Human-authored, route-scoped **annotations** with a **local-first loop**: annotations live in the plugin's storage outbox, and egress rides a capability seam — `feedback.sink` — that is probed, never required, with **no v1 provider shipped**. Absent a sink, the loop still closes locally.

Two policies define the plugin:

- **Creation is human-only.** The agent surface is read + resolve, nothing else — the faster-fixes shape: humans point, agents fix.
- **Storage is working state, not a system of record.** An annotation's durable home is wherever a sink puts it; the outbox holds what awaits action or egress.

## 2. Manifest

*Consolidates: #14.*

```ts
definePlugin({
  id: 'reference.feedback',
  name: 'Feedback',
  version: '1.0.0',
  description: 'Route-scoped annotations with a human→agent resolution loop',
  requires: ['toolbar@^1', 'dom.inspector@^1'],
  permissions: ['bridge:commands', 'bridge:events', 'storage:use'],
  setup, // §4
})
```

- **Hard requires** `toolbar` (the compose/list panel is the product) and `dom.inspector` (anchoring, §5). **Probes** `feedback.sink` with `services.tryGet` — the suite's **tryGet-absent** path, since no v1 provider exists.
- **Deliberately no `bridge:context`**: the `feedback.open-count` key does not exist at the bridge — permission = existence, demonstrated in the negative ([bridge spec §3.3](../bridge-protocol.md#33-permission--existence-when--listing)).
- `storage:use` is the suite's only storage grant ([kernel spec §13.5](../kernel-api.md#135-permission-storageuse)).

## 3. The annotation record

*Consolidates: #14, #12.*

```ts
interface Annotation {
  id: string                  // plugin-minted, unique within the outbox
  route: string               // the route the annotation belongs to
  body: string                // the human's words
  anchor?: ElementDescription // durable element anchor — NEVER an ElementReference
  status: 'draft' | 'open' | 'resolved'
  resolution?: string         // required by feedback.resolve (§4)
  createdAt: string           // ISO 8601
  updatedAt: string           // ISO 8601
}
```

Wire-legal by construction ([kernel spec §14](../kernel-api.md#14-the-wire-legal-rule)). The anchor is an **element description** ([inspector contract §7](../dom-inspector-contract.md#7-element-descriptions-the-durable-anchor-split)) — fuzzy, best-effort, reload-surviving; storing an ElementReference is always a bug.

**Lifecycle `draft` → `open` → `resolved`:**

- Drafts are private working state; they persist in storage and survive reload.
- Submission (draft → open) is the moment an annotation becomes visible to agents and eligible for egress; it fires `feedback.submitted`. A sink, when present, gets first crack at the submission.
- `feedback.resolve` MUST require a resolution note saying what was done.
- Resolved annotations stay in the outbox until egressed or cleared from the panel.

Stored records are read defensively ([kernel spec §13.4](../kernel-api.md#134-durability-reachability-not-shape)).

## 4. Registered surface

*Consolidates: #14.*

| Kind | Name | Notes |
|---|---|---|
| Command | `feedback.list` | defaults to `open`; status filter available |
| Command | `feedback.resolve` | resolution note required; fires `feedback.resolved` |
| Event | `feedback.submitted` | fired draft → open; lands in the tail buffer, making the agent loop **reactive** rather than polled |
| Event | `feedback.resolved` | announcement of a closed loop |
| Context | `feedback.open-count` | **page-only** (no `bridge:context`, §2); feeds the panel item's badge (§7) |

## 5. Anchoring rides the loose route

*Consolidates: #14.*

To anchor a new annotation the plugin invokes `dom.pick-element` through `api.commands.execute` — in-page cross-plugin dispatch, `invocation.source: 'plugin'` ([kernel spec §6.1](../kernel-api.md#61-registration-and-dispatch)); this brief is the suite's only validator of that path — observes `dom.selected-element`, then hydrates the `description` facet via the inspector **service** for the durable anchor. Reference for the living page, description for the stored record ([inspector contract §7](../dom-inspector-contract.md#7-element-descriptions-the-durable-anchor-split)).

## 6. Composition: drafting from scan results

*Consolidates: #14, #13.*

The plugin observes `a11y.scan-completed` — the suite's only in-page cross-plugin Event subscription — and the panel then offers **"draft annotations from these violations"**: anchors hydrated from the violations' ElementReferences, bodies prefilled from rule help, landing as ordinary drafts the human reviews before submitting. This closes the original inspector → scanner → tracker chain ([stress test, scenario 1](../../../prototypes/primitive-stress-test/README.md)).

## 7. Toolbar contribution

*Consolidates: #14.*

- **Panel** — id `feedback.panel`, title "Feedback": annotation list for the current route, compose/draft/submit, clear-resolved.
- **Panel item** — opens the panel, with `badge: { context: 'feedback.open-count' }` ([toolbar contract §4.3](../toolbar-contract.md#43-badges)).

## 8. Flagship success criterion: the agent loop

*Consolidates: #14, #13.*

The workflow the plugin exists to prove ([stress test, scenario 2](../../../prototypes/primitive-stress-test/README.md)):

1. A human annotates an element and submits.
2. `feedback.submitted` appears in `switchboard.events.tail` ([bridge spec §11.3](../bridge-protocol.md#113-switchboardeventstail)).
3. An agent calls `feedback.list`, fixes the code, calls `feedback.resolve` with a note.
4. The human sees the resolution in the panel.

## 9. Coverage role

*Consolidates: #14.*

Validates, for the suite's coverage matrix ([index](../README.md)):

- storage: the outbox, `storage:use`, defensive reads, reload survival;
- permission = existence **in the negative** (`feedback.open-count` never at the bridge);
- the **tryGet-absent** path (`feedback.sink`);
- in-page cross-plugin command dispatch (`invocation.source: 'plugin'`);
- in-page cross-plugin Event subscription (`a11y.scan-completed`);
- element descriptions as durable anchors;
- the full human → agent → human loop over the bridge.

The `feedback.sink` seam is one of the recorded doors to the (out-of-scope) production egress effort; the others are the bridge handshake's reserved `auth` field ([bridge spec §15.4](../bridge-protocol.md#154-the-reserved-auth-field)) and WebMCP shape-compatibility.
