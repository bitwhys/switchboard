# Switchboard — Workstreams and Task Migration

## Active workstreams

| Order | Workstream | Owns | Does not own |
|---:|---|---|---|
| 00 | Control Room | Product model, decisions, integration, scope arbitration, reference-app set | Detailed domain research |
| 10 | Core Primitives | Runtime, apps, contributions, agent actions, feedback, context, events, grants, capabilities, manifests, SDK, plugin compatibility | Local session transport or Vite-specific facilities |
| 20 | Local Agent Session | Dev-session identity, discovery, toolbar/adapter connection, terminal-chat routing, reconnect/teardown | Generic core schemas |
| 30 | Extension | MV3 worlds, handshake, lifecycle, permissions, state classification, origin link enforcement, explicit production activation | Destination delivery internals |
| 40 | Destinations & Delivery | Webhook contract, GitHub adapter, authentication, signing, retries, idempotency, results | Evidence creation/masking |
| 50 | Evidence & Visual Editing | Screenshot/DOM evidence, masking, storage requirements, visual preview/diff | Downstream automation |
| 60 | Consistency | Non-goals, terminology, contradiction and final scope pass | Reopening accepted design without escalation |

The first-party Vite adapter belongs at the boundary between Core Primitives and Local Agent Session: Core Primitives owns its generic contracts; Local Agent Session owns development-session transport and discovery. Vite-specific implementation details must not leak into the public app SDK.

## Current question routing

| Workstream | Owned questions | ADRs to apply first | ADR-0011 follow-up |
|---|---|---|---|
| 00 — Control Room | Q-009, Q-013 | All accepted ADRs, especially ADR-0010 and ADR-0011 | Arbitrate hosted scope and choose the two reference apps; do not perform their detailed domain design. |
| 10 — Core Primitives | Q-008 and Q-011 resolved | ADR-0001, ADR-0004, ADR-0005, ADR-0007, ADR-0011, ADR-0012 | Apply the accepted portable app, contribution, schema, lifecycle, and environment-capability contracts; investigate only targeted follow-ups assigned by Control Room. |
| 20 — Local Agent Session | Q-001, Q-002 | ADR-0001, ADR-0004, ADR-0011 | Re-evaluate discovery and terminal routing with the Vite package as an adapter to generic runtime contracts; coordinate with Q-011 without owning it. |
| 30 — Extension | Q-005, Q-010, Q-012 | ADR-0002, ADR-0003, ADR-0011, ADR-0012 | Define explicit production activation and keep standalone-extension behavior distinct from embedded portable-runtime behavior. |
| 40 — Destinations & Delivery | Q-004 | ADR-0002, ADR-0008, ADR-0011 | Preserve the generic destination boundary; identify only concrete effects of app-originated feedback and semantic agent contributions. |
| 50 — Evidence & Visual Editing | Q-003, Q-006, Q-007 | ADR-0003, ADR-0011 | Keep annotation and visual editing as app-layer behavior; provide requirements to Q-011 and Q-013 without shaping core around annotation. |
| 60 — Consistency | None | All accepted ADRs, especially ADR-0011 | Check that toolbar-first, Vite-coupled, annotation-as-product, implicit-production, and AXI-compliance framings do not remain in canonical or proposed material. |

## Working protocol

1. A workstream investigates an owned question and writes a proposal.
2. Cross-workstream consequences are listed explicitly; sibling files are not edited.
3. The Control Room accepts, rejects, or defers cross-cutting proposals.
4. Accepted decisions receive a numbered ADR and update the project brief.
5. Affected workstreams receive narrow follow-up instructions referencing that ADR.

## Historical task map

The original review used section-based delegated tasks in generated projectless workspaces. Treat them as research sources, not active project membership:

| Historical task | Reusable findings | Successor |
|---|---|---|
| Workstream 1 / later `00 - Control room` | Grants, schema/versioning, plugin distribution, DOM/React ownership; later product decisions | 00, 10, and 20 as appropriate |
| Workstream 2 / `02 - Extension` | MV3 handshake, lifecycle, detection, permissions | 30 |
| Workstream 3 / `GitHub & Webhook Contract` | GitHub App model, delivery security/reliability | 40 |
| Workstream 4 / `Production Capture Safety` | Production invariant, masking, evidence, visual editing | 50 |
| Workstream 5 / `50 - Consistency` | Non-goal and terminology cross-check | 60 |
| `Red-team runtime problem statement` | Original orchestration and broad problem inventory | Reference only |
| ChatGPT `Red-teaming Design Document` | Original broad red-team | Reference only |
| ChatGPT `Production Safety Invariant Issues` | Accepted production-boundary reasoning | Captured by ADR-0003 |

## Successor-task rule

Create every active successor task against this saved local project/worktree. Its initial prompt must name exactly one workstream, list the relevant question IDs and ADRs, and forbid edits to sibling-owned files or canonical decisions without Control Room approval.
