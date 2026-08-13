# ADR-0012: Adopt developer-owned apps and lean portable core contracts

- **Status:** Accepted · 2026-08-13
- **Supersedes:** ADR-0001 and ADR-0006
- **Clarifies:** ADR-0004, ADR-0005, and ADR-0011
- **Closes:** Q-008 and Q-011

## Context

ADR-0011 made the app the primary extension unit but left its schema, lifecycle, capabilities, and agent projection unresolved. Treating npm publishing, globally unique app identities, competing capability providers, granular grant administration, and dynamic revocation as v1 requirements would optimize for a hypothetical ecosystem rather than the motivating developer-owned toolkit.

## Decision

An app is a local or imported JavaScript/TypeScript module explicitly registered in one developer-owned project configuration. npm may distribute a module but is not part of the app contract. App IDs are stable lowercase configuration-local slugs; contribution identity is `(appId, contributionId)`.

V1 defines four contribution types: `ui`, `command`, `agentAction`, and `feedback`. Switchboard defines no separate `tool` entity or contribution. Agent adapters expose eligible agent actions through their native protocol; a protocol such as MCP may use its own tool-shaped representation without introducing a Switchboard tool abstraction. Human commands, agent actions, and feedback remain distinct even when they share app-domain functions or schema fragments.

The typed app definition contains declarative contract data and handler bindings; its serializable projection is the manifest. Use JSON Schema draft 2020-12, integer manifest schema versions, bundled stable absolute `$id` URIs, one supported manifest version per runtime release, no network schema fetching, and closed project-owned manifest and envelope objects. Validate each app definition atomically before exposing anything, then activate environmentally eligible contributions independently.

A capability is a typed, named, exact-major-version environment-service contract. V1 has one developer-configured environment and at most one implementation per capability. Requirements normally attach to contributions and are injected without a global service locator. Provider marketplaces, precedence, version ranges, and fine-grained provider churn are deferred. The initial tracer set covers toolbar and overlay hosts, browser targeting, development source resolution, and editor opening; further contracts require reference-app evidence.

V1 assumes one explicitly authorized local coding-agent session. Ending that session removes access. No public app-specific permission matrix, dynamic grant administration, or mid-session revocation protocol is defined. Each agent action declares `read-only`, `temporary-change`, `persistent-change`, or `external-side-effect` consequence metadata. Default policy runs the first two and requests confirmation for the latter two; developer configuration may allow greater autonomy. Consequence metadata never grants authority.

ADR-0004's authorization and concurrency rules apply to agent-action invocation. Its use of “tool” is historical terminology and does not preserve a separate product entity.

Registration follows `validate -> register -> setup -> activate`; teardown follows `deactivate -> dispose`. Missing capabilities make affected contributions unavailable. Cleanup completes before the runtime removes its UI hosts. Execution defaults to `exclusive`, with explicit `parallel` and `drop-if-running`; Core does not automatically retry capability operations.

## Consequences

Package API, manifest schema, and bridge compatibility remain separate, and package compatibility still uses SemVer when packages are used. Explicit registration replaces ADR-0006's npm-only plugin framing and still forbids implicit or remote executable-code discovery.

Workstream 20 owns local session authorization and transport. Workstream 30 owns production activation and standalone-extension registrations. Workstream 40 owns feedback dispatch. Workstream 50 owns target snapshots, evidence, masking, and visual-edit semantics. Reference apps validate candidate capabilities before they become durable public contracts.
