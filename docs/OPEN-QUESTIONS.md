# Switchboard — Open Questions

Workstreams investigate and propose. The Control Room accepts cross-cutting decisions, writes or supersedes an ADR, and updates the canonical brief.

## P0 — End-to-end workflow blockers

### Q-001 — Local session identity and discovery

**Owner:** Local Agent Session  
**Coordinates with:** Core Primitives

Define who creates the session identity, how the page discovers it, and how the toolbar locates the local adapter.

### Q-002 — Terminal-conversation routing

**Owner:** Local Agent Session

Define how feedback is associated with the terminal conversation that started or owns the dev session, including no-agent, disconnect, reconnect, and teardown behavior.

### Q-003 — Evidence transport and storage

**Owner:** Evidence & Visual Editing  
**Coordinates with:** Destinations & Delivery

Choose the v1 topology for screenshot/DOM bytes and specify size limits, ownership, retrieval authorization, retention, deletion, retry, and failure behavior.

### Q-004 — Generic webhook destination contract

**Owner:** Destinations & Delivery

Define endpoint validation, exact-origin binding, authentication/signing, credential storage, revocation, redirects, response semantics, and SSRF protection. Prove the contract with a receiver requiring no GitHub or repository data.

## P1 — Production safety and interoperability

### Q-005 — Origin-to-destination authority

**Owner:** Extension  
**Coordinates with:** Destinations & Delivery, Evidence & Visual Editing

Choose independent origin proof or explicit installer attestation and document re-verification, unlinking, revocation, and residual evidence-disclosure risk.

### Q-006 — Exact masking transformation

**Owner:** Evidence & Visual Editing

Freeze payment/card autocomplete tokens, subtree replacement, retained attributes, Shadow DOM/iframe treatment, and screenshot/DOM parity.

### Q-007 — Visual-editor utility grammar

**Owner:** Evidence & Visual Editing

Freeze the utility version/set, namespace, modifiers, arbitrary-value behavior, and computed-style fallback.

### Q-008 — Separate agent-action and feedback schemas — Resolved by ADR-0012

**Owner:** Core Primitives

ADR-0012 selects JSON Schema draft 2020-12, stable configuration-local identities, integer schema and action-contract versions, closed project-owned envelopes, separate agent-action and feedback contracts, and atomic definition validation.

## P2 — Scope choices

### Q-009 — Server deployment assumption

**Owner:** Control Room

Choose self-hostable-only v1 or explicitly scope an optional hosted deployment. Current recommendation: self-hostable-only.

### Q-010 — Standalone extension action set

**Owner:** Extension  
**Coordinates with:** Core Primitives

Enumerate the finite first-party agent actions registered when no embedded application runtime exists.

### Q-011 — App contribution and capability contract — Resolved by ADR-0012

**Owner:** Core Primitives
**Coordinates with:** Local Agent Session, Extension

ADR-0012 defines the four contribution types, typed exact-major capability services, single configured environment, requirement injection, UI ownership, target/source seams, failure surface, concurrency, and registration lifecycle.

### Q-012 — Explicit production activation

**Owner:** Extension
**Coordinates with:** Core Primitives

Define how production-capable apps are explicitly included, mounted, and made visible to selected users without making production activation an automatic consequence of adding the Vite development integration. Preserve ADR-0003's production capability boundary.

### Q-013 — Reference-app validation set

**Owner:** Control Room
**Coordinates with:** Core Primitives, Evidence & Visual Editing

Choose the two first-party reference apps used to validate the generic extension model. Current recommendation: annotation plus accessibility inspection. Keep their domain behavior outside core and require both to fit without app-specific core exceptions.
