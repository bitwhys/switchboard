# ADR-0010: Integrate cross-cutting decisions through the Control Room

- **Status:** Accepted · 2026-08-12
- **Replaces:** Ad hoc cross-workstream file propagation

## Context

Independent task conversations and generated workspaces made it unclear when exploratory conclusions became project-wide decisions. One task previously edited all sibling memos directly.

## Decision

Workstreams investigate locally and may author Proposed ADRs. The Control Room accepts, rejects, or supersedes cross-cutting ADRs and updates the canonical brief. Affected workstreams receive targeted follow-ups referencing the ADR; they edit only their owned artifacts.

## Consequences

Decision authority and propagation are inspectable. Cross-cutting changes require an explicit integration step. Successor tasks should follow `docs/WORKSTREAMS.md`.
