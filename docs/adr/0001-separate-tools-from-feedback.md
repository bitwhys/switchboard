# ADR-0001: Separate tools from feedback

- **Status:** Accepted · 2026-08-12
- **Replaces:** “Everything is a command” and `dev+production`

## Context

The original model used one command abstraction for operations performed during development and requests recorded remotely. Imperative names such as “toggle feature flag” became misleading when the production behavior created an Issue instead of toggling anything.

## Decision

Use five core primitives: tools, feedback, context, events, and grants. Tools are operations that may run in a live development session. Feedback is a structured observation or request delivered to a local agent session or remote destination. Feedback is not an alternate execution mode of a tool. Remove `dev+production` and command-to-capture projection.

## Consequences

Development execution and durable feedback have direct contracts and can evolve independently. Some shared metadata will require explicit reuse. Separate schemas remain to be defined under Q-008.
