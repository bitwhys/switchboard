# ADR-0007: Limit v1 framework delivery to manual embedding and Vite

- **Status:** Accepted · 2026-08-12
- **Replaces:** Implied first-party Next.js and Nuxt delivery

## Context

The original document limited v1 to a vanilla core and React binding but listed Vite, Next.js, and Nuxt injection mechanisms, creating hidden implementation and test obligations.

## Decision

v1 supports manual embedding and a first-party Vite integration. Other framework-specific bindings and injection integrations are deferred.

## Consequences

v1 has a finite, testable delivery target. Other adopters must integrate manually until later bindings exist.
