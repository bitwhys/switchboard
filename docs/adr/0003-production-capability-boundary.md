# ADR-0003: Define the production capability boundary

- **Status:** Accepted · 2026-08-12
- **Replaces:** “Never touch production”

## Context

DOM inspection, screenshots, and temporary visual editing necessarily observe or modify the live rendered document. The former absolute invariant contradicted the motivating features.

## Decision

In production, Switchboard may inspect and temporarily modify presentation-layer state in the live document. It must not directly access application-runtime state, run development tools against the deployed application, or intentionally persist application/server state. Temporary DOM mutation is a behavioral constraint, not a security sandbox; avoid calling it “sandboxed.”

## Consequences

The invariant now matches browser behavior. Presentation mutation may have host-observable side effects, so restoration, masking, and evidence handling remain required under Q-003, Q-006, and Q-007.
