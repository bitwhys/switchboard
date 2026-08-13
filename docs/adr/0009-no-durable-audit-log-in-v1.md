# ADR-0009: Exclude durable audit logging from v1

- **Status:** Accepted · 2026-08-12
- **Closes:** The open audit-log subsystem question

## Context

A durable audit log would introduce identity semantics, persistence, retention, and potentially remote sinks without a locked product requirement.

## Decision

v1 defines no durable audit-log subsystem or remote audit sink. Ordinary diagnostic logs remain implementation detail.

## Consequences

This avoids an unbounded persistence and identity subsystem. v1 provides no stable compliance-grade activity history.
