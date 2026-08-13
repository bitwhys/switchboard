# ADR-0004: Separate grants, risk, and tool concurrency

- **Status:** Accepted · 2026-08-12
- **Replaces:** Risk-derived concurrency defaults and placeholder context versioning

## Context

Risk classification does not determine authorization, reentrancy, resource conflicts, or whether dropping an invocation is acceptable.

## Decision

Runtime grants alone authorize callers; risk metadata only classifies a tool. A plugin cannot grant authority to itself. Tools default to `exclusive`; authors may explicitly select `parallel` or `drop-if-running`. `drop-if-running` returns `already_running`. Do not include optimistic context versioning in v1 without a concrete versioned resource and atomic comparison contract.

## Consequences

Defaults are safe and predictable without speculative machinery. Authors must opt into concurrency when they can guarantee it is safe.
