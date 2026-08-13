# Switchboard — Project Brief

**Status:** Canonical  
**Last integrated:** 2026-08-12

## Product thesis

Switchboard is an open-source developer-tool runtime connecting a human-facing toolbar and browser extension to coding agents.

- During development, it supports a live human-agent iteration loop over the running application.
- Against a deployed application, it turns structured feedback and captured evidence into work delivered to a configured destination.
- The included GitHub adapter creates Issues. Adopter-owned webhook receivers may implement other workflows without making GitHub or a repository part of the core runtime.

## Primary workflows

### Local development

An agent starts or joins a development session. The toolbar exposes development tools and accepts structured feedback. The attached agent receives the relevant tools, context, feedback, and events; changes source code; and reports through the terminal conversation associated with the session.

### Remote feedback

The extension associates an exact deployed origin with a configured destination, collects structured feedback and permitted rendered-page evidence, and sends a versioned authenticated event. The destination owns the downstream workflow.

The deployed application is not a development-tool execution target. The extension may inspect rendered content and apply reversible tab-local visual previews, but it does not intentionally persist application or server changes.

## Core primitives

- **Tools:** operations available in a live development session, subject to grants.
- **Feedback:** structured human observations or requests with optional evidence.
- **Context:** facts about the page and active session.
- **Events:** lifecycle notifications connecting the core and its surfaces.
- **Grants:** runtime authorization controlling discovery and use.

Feedback is not an alternate execution mode of a tool.

## Surfaces and ownership

- A UI-independent vanilla JS/TS core owns toolbar DOM.
- React is an optional binding and owns only children mounted into declared portal slots.
- First-party surfaces are the embedded toolbar, Chrome extension, and MCP-primary local agent adapter.
- v1 supports manual embedding and Vite integration.
- Plugins are explicitly installed/imported npm packages, not dynamically discovered extension code.

## Extension modes

1. **Embedded runtime present:** a compatible page handshake prevents a duplicate extension runtime.
2. **Authorized local development:** eligible local origins may expose bundled development tools after explicit authorization; passive signals never grant authority.
3. **Linked remote feedback:** an exact origin has an active destination link; the extension collects and sends feedback but exposes no development tools.

## Destination model

The core association is **origin → feedback destination**, not origin → repository.

- The included GitHub adapter uses a GitHub App installation and selected repository to create Issues.
- An adopter-owned webhook requires neither GitHub nor a repository in the core.
- The project does not promise Bitbucket or other downstream adapters.
- Destination authority is configured outside page content and bound to an exact origin.

## Production boundary

In production, Switchboard may inspect and temporarily modify presentation-layer state in the live document. It must not directly access application-runtime state, run development tools against the deployed application, or intentionally persist application/server state.

Visual-edit diffs are evidence, not executable source patches. Masking is applied before dispatch, and masking failure must not fall back to unmasked delivery.

## Compatibility and distribution

- One manifest schema version is active; unsupported schemas fail before partial registration.
- Bridge protocol, manifest schema, and package API compatibility are separate checks.
- Packages use SemVer and declare compatible runtime/binding ranges.
- Plugins are ordinary npm dependencies explicitly installed and imported by adopters.

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

Accepted decisions are recorded as individual ADRs under `docs/adr/`; unresolved decisions are owned in `OPEN-QUESTIONS.md`. Workstream notes are inputs, not competing sources of truth.
