# Switchboard — Workstreams and Task Migration

## Active workstreams

| Order | Workstream | Owns | Does not own |
|---:|---|---|---|
| 00 | Control Room | Product model, decisions, integration, scope arbitration | Detailed domain research |
| 10 | Core Primitives | Tools, feedback, context, events, grants, manifests, SDK, plugin compatibility | Local session transport |
| 20 | Local Agent Session | Dev-session identity, discovery, toolbar/adapter connection, terminal-chat routing, reconnect/teardown | Generic core schemas |
| 30 | Extension | MV3 worlds, handshake, lifecycle, permissions, state classification, origin link enforcement | Destination delivery internals |
| 40 | Destinations & Delivery | Webhook contract, GitHub adapter, authentication, signing, retries, idempotency, results | Evidence creation/masking |
| 50 | Evidence & Visual Editing | Screenshot/DOM evidence, masking, storage requirements, visual preview/diff | Downstream automation |
| 60 | Consistency | Non-goals, terminology, contradiction and final scope pass | Reopening accepted design without escalation |

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
