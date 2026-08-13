# ADR-0005: Keep toolbar DOM ownership in the vanilla core

- **Status:** Accepted · 2026-08-12

## Context

The core owns toolbar DOM while optional React content may be portaled into it. Without an explicit subtree boundary, both systems could reconcile or remove the same nodes.

## Decision

The vanilla core owns the toolbar DOM, each portal-slot element, and surrounding structure. React owns only the child subtree of an attached portal slot. The core coordinates adapter cleanup before removing a slot.

## Consequences

Every DOM subtree has one owner. The adapter lifecycle must explicitly clean up portals before the core removes their slots.
