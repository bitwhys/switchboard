# Switchboard — Project Brief

**Status:** Canonical  
**Last integrated:** 2026-08-13

## Product thesis

Switchboard is an open-source, extensible in-page developer-tooling platform for Vite applications. It brings an Astro-style app surface to ordinary Vite projects that do not already have a framework-owned equivalent, while preserving a portable browser runtime for compatible production use.

- During development, it hosts human-facing and agent-facing app contributions and supports a live human-agent iteration loop over the running application.
- Against a deployed application, it turns structured feedback and captured evidence into work delivered to a configured destination.
- The included GitHub adapter creates Issues. Adopter-owned webhook receivers may implement other workflows without making GitHub or a repository part of the core runtime.

Vite is the initial product wedge and first-party development adapter, not the fundamental runtime abstraction and not a development-only limitation.

## Product model

A **Switchboard app** is the primary extension unit. An app may contribute to one or more surfaces, including the default toolbar host, semantic agent actions, commands, and development-server facilities. It need not have a toolbar panel, and the toolbar does not own its domain behavior.

V1 is a developer-owned kit rather than an app marketplace. Apps are local or imported JavaScript/TypeScript modules registered in one project configuration. npm is an optional distribution mechanism, not part of the portable app contract. App IDs are stable configuration-local slugs; contribution identity is the pair `(appId, contributionId)`.

The architecture separates:

- a portable browser runtime for app registration, lifecycle, UI hosting, overlays and panels, isolation boundaries, browser events, capability discovery, and environment awareness;
- a public app SDK whose generic contracts do not expose Vite-specific APIs; and
- a Vite adapter for development injection, HMR, browser/server transport, source and module metadata, source resolution, and development-only server or filesystem facilities.

`@switchboard-dev` is the canonical npm scope in examples and planning. Exact package names remain open; likely responsibility boundaries resemble `@switchboard-dev/runtime`, `@switchboard-dev/sdk`, and `@switchboard-dev/vite`.

## Primary workflows

### Local development

The Vite adapter injects or joins the portable runtime during development. An agent starts or joins a development session. Installed apps expose available human and semantic agent contributions according to runtime grants and environment capabilities. The attached agent receives relevant actions, context, feedback, and events; changes source code; and reports through the terminal conversation associated with the session.

### Remote feedback

The extension associates an exact deployed origin with a configured destination, collects structured feedback and permitted rendered-page evidence, and sends a versioned authenticated event. The destination owns the downstream workflow.

The deployed application is not a development-tool execution target. The extension may inspect rendered content and apply reversible tab-local visual previews, but it does not intentionally persist application or server changes.

## Runtime concepts

- **Agent actions:** schema-described semantic operations an authorized coding agent may request.
- **Feedback:** structured human observations or requests with optional evidence.
- **Context:** facts about the page and active session.
- **Events:** lifecycle notifications connecting the core and its surfaces.
- **Grants:** runtime authorization controlling discovery and use.

Feedback is not an alternate execution mode of an agent action.

Apps may project shared domain operations into distinct human and agent interfaces. Agents receive purpose-built semantic actions rather than automating the human toolbar UI. This principle does not make AXI compliance or its complete implementation model a project goal.

V1 has four public app contribution types:

- **UI:** human-facing content mounted into a declared host.
- **Command:** a semantic human-triggered action discoverable by compatible hosts.
- **Agent action:** a schema-described semantic operation exposed to compatible agent adapters.
- **Feedback:** a structured feedback kind and draft contract.

Switchboard defines no separate `tool` entity or contribution. An external protocol such as MCP may encode an eligible agent action using that protocol's own tool-shaped message, but this does not create a Switchboard tool abstraction. Commands do not become agent actions automatically, and actions do not become feedback automatically.

## Capabilities and environments

Apps declare the capabilities required by their contributions. The runtime determines availability in the current environment so app implementations do not need scattered environment checks.

Development adapters may provide capabilities such as source resolution, server RPC, and development storage. The portable production runtime exposes only its deliberately narrower browser and presentation capabilities. Capability declarations are an architectural and portability boundary, not a claim that installed third-party code is securely sandboxed.

A capability is a typed, named, exact-major-version environment-service contract. V1 composes one developer-configured environment with at most one implementation of each capability; duplicates are invalid configuration. It defines no provider marketplace, precedence system, or fine-grained provider-churn protocol.

The initial tracer set is toolbar hosting, overlay hosting, browser targeting, development source resolution, and editor opening. Additional capabilities require concrete reference-app evidence. Ordinary DOM access remains ambient rather than being wrapped as a security boundary.

## Surfaces and ownership

- The portable, UI-independent vanilla JS/TS runtime owns the default toolbar host DOM.
- React is an optional binding and owns only children mounted into declared portal slots.
- The toolbar is the default human-facing app host, not the product's fundamental abstraction.
- First-party surfaces and adapters are the embedded toolbar host, Chrome extension, Vite development adapter, and MCP-primary local agent adapter.
- v1 supports manual embedding and Vite integration.
- Apps and plugins are explicitly installed/imported npm packages, not dynamically discovered extension code.

The core remains deliberately small: runtime/injection, app registration, UI hosting, lifecycle, browser/server transport when available, and capability/environment discovery. Feature domains such as annotations, accessibility inspection, responsive tools, feature flags, mock data, API inspection, design tokens, performance tooling, and agent integrations belong in apps.

A first-party annotation app is the flagship reference app, not the product definition. A materially different second app, such as accessibility inspection, should validate that the SDK does not require app-specific exceptions.

## Extension modes

1. **Embedded runtime present:** a compatible page handshake prevents a duplicate extension runtime.
2. **Authorized local development:** eligible local origins may expose bundled agent actions after explicit authorization; passive signals never grant authority.
3. **Linked remote feedback:** an exact origin has an active destination link; the extension collects and sends feedback but exposes no development agent actions.

## Destination model

The core association is **origin → feedback destination**, not origin → repository.

- The included GitHub adapter uses a GitHub App installation and selected repository to create Issues.
- An adopter-owned webhook requires neither GitHub nor a repository in the core.
- The project does not promise Bitbucket or other downstream adapters.
- Destination authority is configured outside page content and bound to an exact origin.

## Production boundary

In production, Switchboard may inspect and temporarily modify presentation-layer state in the live document. It must not directly access application-runtime state, run development tools against the deployed application, or intentionally persist application/server state.

Visual-edit diffs are evidence, not executable source patches. Masking is applied before dispatch, and masking failure must not fall back to unmasked delivery.

Production activation is explicit. Adding the Vite integration must not by itself make Switchboard production-visible. Adopters opt in through production configuration or explicit browser mounting and may restrict availability to selected users such as internal QA, designers, support personnel, or authorized agents.

## Compatibility and distribution

- One manifest schema version is active; unsupported schemas fail before partial registration.
- Manifests use JSON Schema draft 2020-12, integer schema versions, bundled stable `$id` URIs, and no runtime schema fetching.
- Bridge protocol, manifest schema, and package API compatibility are separate checks.
- Packages, when used, apply SemVer and declare compatible runtime/binding ranges.
- Apps are explicitly registered local or imported modules; there is no implicit discovery.

V1 assumes one explicitly authorized local coding-agent session. Session authorization permits requesting eligible agent actions; it does not remove confirmation policy. Agent actions declare one consequence category: `read-only`, `temporary-change`, `persistent-change`, or `external-side-effect`. The default runs the first two and requests confirmation for the latter two. Consequence metadata never grants authority.

## Explicitly out of scope for v1

- “Everything is a command,” `dev+production`, or command-to-capture projection
- Development-tool execution against deployed applications
- Automatic source mapping, code changes, or pull requests from remote feedback
- A project-built Bitbucket, Jira, Linear, or similar adapter
- Hosted plugin marketplace or automatic plugin installation
- Generic identity-provider or authorization-server support
- Durable audit-log subsystem or remote audit sink
- Heuristic/general-purpose PII detection
- First-party Next.js, Nuxt, Vue, Svelte, or other framework integrations
- A required vendor-operated SaaS or dashboard
- AXI compliance or adoption of AXI's complete implementation model
- Treating annotation tooling or the toolbar UI as the product's fundamental abstraction

Accepted decisions are recorded as individual ADRs under `docs/adr/`; unresolved decisions are owned in `OPEN-QUESTIONS.md`. Workstream notes are inputs, not competing sources of truth.
