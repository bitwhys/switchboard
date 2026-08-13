# ADR-0011: Make Switchboard a Vite-first portable app runtime

- **Status:** Accepted · 2026-08-13
- **Clarifies:** ADR-0003, ADR-0005, and ADR-0007

## Context

The earlier framing centered the toolbar, browser extension, and agent feedback workflow. It did not identify a sufficiently narrow initial product wedge and risked making the toolbar UI or Vite development server the durable abstraction.

Astro demonstrates a first-class extension surface for in-page developer tools. Ordinary Vite applications have useful infrastructure but lack an equivalent higher-level convention for registering, hosting, activating, and communicating with developer-tool apps.

## Decision

Position Switchboard as an extensible in-page developer-tooling platform for Vite applications. Vite is the initial market wedge and first-party development adapter, not the fundamental runtime abstraction and not a development-only constraint.

Make the Switchboard app the primary extension unit. Apps may contribute human-facing UI, semantic agent actions, commands, and development-server facilities over shared domain operations. Apps need not contribute toolbar UI, and agents must not depend on automating that UI.

Keep the browser runtime portable and keep Vite-specific injection, HMR, source metadata and resolution, browser/server communication, and development-only facilities behind generic SDK contracts. Model contribution availability through declared capabilities resolved for the current environment. These capabilities are portability boundaries, not a security sandbox for explicitly installed app code.

Production activation is explicit and retains ADR-0003's narrower capability boundary. Use `@switchboard-dev` as the canonical npm scope when package examples are useful; exact package names remain open.

## Consequences

The toolbar remains the default human-facing host and retains the DOM ownership boundary in ADR-0005, but no longer defines the product model. ADR-0007's manual-embedding and Vite delivery scope remains intact. Core stays small; annotation and accessibility behavior belong in reference apps rather than app-specific core APIs.

Q-008 must include capability metadata without conflating agent actions and feedback. Q-011 defines the app and capability contract, Q-012 defines explicit production activation, and Q-013 selects the reference-app validation set.
