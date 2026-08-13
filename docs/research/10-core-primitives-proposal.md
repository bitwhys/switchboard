# Workstream 10 proposal: developer-owned apps and core contracts

**Status:** Integrated by ADR-0012; retained as non-canonical design detail
**Owns:** Q-008, Q-011
**Applies:** ADR-0001, ADR-0004 through ADR-0007, ADR-0011

**Control Room terminology correction:** Switchboard has no separate `tool` entity. Where this proposal says an adapter projects an agent action into a protocol-native tool, that means only that an external protocol such as MCP may use a tool-shaped representation.

## Recommendation

Treat Switchboard as a developer-owned kit for adding in-page tools and exposing semantic actions to the developer's coding agent. An app is a local or imported JavaScript/TypeScript module registered in one project configuration. npm may distribute a module, but packaging, publishing, marketplaces, competing providers, and mutually distrusting plugins are not part of the v1 app contract.

Core stays small. It validates typed app definitions, hosts human UI, exposes semantic agent actions through adapters, manages contribution lifecycle and execution mechanics, injects configured environment capabilities, and constructs feedback envelopes. Vite-specific injection, HMR, source mapping, browser/server transport, and development facilities remain behind portable adapter contracts.

Representative app:

```ts
export default defineApp({
  id: "accessibility",
  contributions: [
    ui({ id: "panel", host: toolbarHost, render: AccessibilityPanel }),
    command({ id: "inspect-selection", handler: inspectSelection }),
    agentAction({
      id: "inspect-element",
      contractVersion: 1,
      input: inspectInput,
      output: inspectOutput,
      risk: "read-only",
      handler: inspectElement,
    }),
    feedback({ id: "accessibility-issue", payload: feedbackSchema }),
  ],
});
```

## Q-008: schemas, actions, and feedback

### App definition and manifest

An author supplies one typed app definition containing declarative contract data and runtime handler bindings. Its serializable projection is the portable manifest. Lifecycle hooks do not dynamically invent contributions.

- Use JSON Schema draft 2020-12.
- Manifest instances carry an integer `schemaVersion`.
- Bundled schema documents have stable absolute `$id` URIs; the runtime maps the integer version to a bundled schema and never fetches schemas over the network.
- Support exactly one manifest schema version per runtime release and reject unsupported versions before setup.
- Use `additionalProperties: false` for project-owned manifest and envelope objects. App-owned payload schemas choose their own unknown-field policy explicitly.
- Provide no generic extension metadata bag in v1. Adapter-specific configuration remains outside the portable manifest.
- Keep repository, destination, Vite, module, source-file, and environment-projection fields out of generic action and feedback contracts.

### Identity and compatibility

App IDs are stable, lowercase configuration-local slugs such as `accessibility`. Contribution IDs are stable lowercase app-local slugs such as `inspect-element`. Public contracts represent identity as `(appId, contributionId)`; private runtime indexes may encode the pair however they choose. IDs are not display labels and must not be reused for different semantics.

Manifest compatibility, package API compatibility, and bridge protocol compatibility remain separate checks. Package distribution is not an app-contract concern.

### Semantic agent actions

App authors define `agentAction` contributions. Each contains stable identity, title and description, input and optional output schemas, integer `contractVersion`, consequence metadata, handler binding, capability requirements, and execution policy.

The contribution ID remains stable while its semantic purpose remains stable. An incompatible input, output, or semantic change increments `contractVersion`; v1 permits one active contract version per contribution identity.

Agent adapters expose eligible agent actions through protocol-native representations. MCP, for example, may encode one using its own tool shape. Switchboard has no separate `tool` entity or contribution. Human commands never become agent actions automatically, and agents never automate the toolbar UI.

### Agent authorization and consequence metadata

V1 assumes one explicitly authorized local coding-agent session. That session may request eligible registered agent actions. V1 defines no app-specific permission matrix, public grant vocabulary, dynamic grant administration, or mid-session revocation protocol. Ending the authorized session removes access. This is the minimal application of ADR-0004's rule that authorization—not risk—permits execution.

Each agent action declares one consequence category:

- `read-only`
- `temporary-change`
- `persistent-change`
- `external-side-effect`

Default policy runs the first two and requests confirmation for the latter two. Developers may configure greater autonomy for their session. Consequence metadata informs confirmation; it never grants authority.

### Separate feedback contract

Feedback remains a structured observation or request, not an action execution mode or automatic projection of an action result. Apps may reuse their own domain-schema fragments across action results and feedback payloads, but envelopes and versioning remain separate.

A `feedback` contribution defines a feedback kind, payload schema, and optional draft construction. Creating a draft has no external side effect. Runtime and delivery infrastructure exclusively own envelope construction, context and evidence attachment, masking gates, destination routing, credentials, retries, and results. Submission is an explicit `external-side-effect`; no command or agent action automatically becomes feedback.

Serialized feedback envelopes contain their schema version, feedback-kind identity and version, instance ID, creation time, structured payload, optional context snapshot, and evidence references. Routing, repository, destination, terminal-conversation association, retention, and transport metadata remain at their owning boundaries.

## Q-011: app, contribution, capability, and lifecycle contract

### Contribution types

V1 exposes four public contribution types:

1. `ui`: human-facing content mounted into a declared host.
2. `command`: a semantic human-triggered action discoverable by compatible hosts.
3. `agentAction`: a semantic agent-triggered action with schemas and consequence metadata.
4. `feedback`: a structured feedback kind and draft contract.

Context and lifecycle events remain scoped SDK plumbing rather than manifest contributions. Environment services are capabilities, not app contributions. Annotation, accessibility, visual editing, and other feature-domain behavior remain app-owned.

### Capability semantics

A capability is a typed, named, exact-major-version service contract supplied by the developer-configured environment through the SDK. It is not an environment label, permission, consequence category, security sandbox, marketplace extension point, or bare boolean flag.

Capability IDs use exact major matching, for example `dev.switchboard.dev.source-resolution@1`. A provider claiming that ID implements the complete v1 interface. Compatible fixes retain the ID; breaking changes receive a new major ID. V1 has no SemVer ranges or runtime version negotiation.

Capabilities are cohesive, independently useful services—not entire environments, app-specific workflows, or arbitrary individual methods. Apps compose capabilities into their own workflows. Vite types and provider implementation details never enter these interfaces.

V1 has one developer-configured environment and at most one implementation of each capability. Duplicate implementations are invalid configuration. There are no public provider identities, precedence rules, provider marketplace, or dynamic provider-selection protocol.

### Candidate v1 capability tracer set

Freeze only contracts validated by concrete reference-app usage:

- `dev.switchboard.ui.host.toolbar@1`
- `dev.switchboard.ui.host.overlay@1`
- `dev.switchboard.browser.targeting@1`
- `dev.switchboard.dev.source-resolution@1`
- `dev.switchboard.dev.editor-open@1`

Defer generic server RPC, development storage, filesystem, module metadata, and evidence capabilities until a concrete app proves their portable contract.

Ordinary browser DOM access remains ambient. `targeting@1` standardizes only Switchboard-specific cross-boundary target/reference behavior; it does not wrap the DOM or claim security mediation.

### Requirements and injection

- App-level requirements are allowed only for facilities essential to every meaningful app state.
- Contribution-level requirements are the default and disable only the affected contribution when absent.
- Explicit optional capabilities may enrich an existing contribution but cannot redefine its primary meaning, authority boundary, or side effects.
- Typed capability tokens pair compile-time interfaces with serializable IDs.
- App-level providers enter app setup; contribution-level providers enter contribution activation. No unrestricted global service locator exists.
- V1 resolves the configured capability set during app/contribution activation. Reconfiguration, adapter reconnect, and HMR may refresh or re-register affected runtime state; fine-grained dynamic provider-churn and optional-provider snapshot machinery are deferred.

### UI hosting and ownership

Toolbar and overlay hosting are separately resolved capabilities under `dev.switchboard.ui.host.*`, while sharing generic mount and cleanup conventions. The vanilla runtime owns each host container and surrounding structure. A binding such as React owns only mounted child content and must clean it up before Core removes the container, preserving ADR-0005.

### Target and source contracts

`targeting@1` creates opaque page-lifetime `TargetReference` handles for live coordination. Source resolution and overlay hosts may consume those handles without inspecting their representation. A separate serializable `TargetSnapshot` is descriptive evidence, not a promise that the exact element can later be resolved. Exact snapshot, evidence, and masking semantics remain Workstream 50's domain.

`source-resolution@1` maps a live target to ordered neutral `SourceLocation` candidates. A location contains an absolute URI and zero-based, start-inclusive/end-exclusive coordinates. `editor-open@1` consumes that neutral contract and may reject unsupported URI schemes. Source locations are local-development context and never enter remote feedback automatically.

### Failures and retries

Keep the portable failure surface small: unavailable capability, invalid configuration or activation, unsupported input, cancellation, and provider failure. Adapter-specific exceptions remain diagnostics and never become portable app control flow. Core performs no automatic capability-operation retries because retries could duplicate side effects.

### Shared handlers and concurrency

Ordinary functions are sufficient by default. The SDK may provide an optional app-local execution wrapper when UI, commands, or agent actions need shared input/output validation, cancellation, structured failures, and concurrency.

The wrapper is not a manifest entity, globally named operation, discovery target, cross-app service, or remotely addressable endpoint. Environment requirements remain on exposed contributions and are passed to the handler. Feedback is never projected automatically.

Concurrency defaults to `exclusive`. Authors may explicitly select `parallel` or `drop-if-running`; the latter returns `already_running`.

### Registration and lifecycle

Registration has two stages:

1. Validate the complete typed definition atomically: schema version, IDs and duplicates, contribution shapes, handler bindings, schemas, capability references, and runtime compatibility. Any failure rejects the entire app and exposes nothing.
2. Activate each environmentally eligible contribution independently. Missing requirements mark that contribution unavailable. Activation failure cleans up and marks only that contribution failed; eligible siblings remain active.

The lifecycle is `validate -> register -> setup -> activate`, with `deactivate -> dispose` for teardown. Contribution cleanup completes before Core removes runtime-owned UI hosts. Vite HMR remains adapter-private and uses this portable lifecycle rather than appearing in the public SDK.

## Control Room decisions required

This locked proposal intentionally narrows accepted or canonical framing and requires Control Room integration before becoming authoritative:

1. Clarify ADR-0006 so project-local app modules are the primary model and npm is merely an optional JavaScript distribution mechanism, not a requirement of the app contract.
2. Accept configuration-local app slugs instead of globally oriented reverse-domain app identity.
3. Supersede the canonical `tool` primitive: `agentAction` is the Switchboard entity, while an external agent protocol may use its own tool-shaped representation.
4. Apply ADR-0004 through explicit local-agent-session authorization rather than a public granular grant vocabulary or dynamic policy system.
5. Narrow capability resolution to one developer-configured environment with at most one implementation per service contract; defer competing providers and dynamic provider churn.

## Cross-workstream consequences

- **Workstream 20 / Q-001 and Q-002:** owns explicit local-session authorization, discovery, terminal routing, reconnect, and teardown. It consumes eligible `agentAction` contributions and projects them through the local agent adapter. Core does not define local session transport.
- **Workstream 30 / Q-010 and Q-012:** the extension exposes only facilities configured for its mode. Standalone tools become its own semantic action registrations. Explicit production activation selects apps and runtime facilities; adding Vite integration does not activate production behavior.
- **Workstream 40 / Q-004:** app-created feedback drafts enter the generic feedback envelope. Destination routing, signing, retries, idempotency, and delivery results remain delivery concerns.
- **Workstream 50 / Q-003, Q-006, Q-007:** owns evidence bytes, masking, storage, visual editing, and snapshot requirements. Annotation and accessibility behavior remain app-domain behavior and must not create app-specific Core exceptions.
- **Control Room / Q-013:** reference apps should validate the four contribution types and candidate capability tracer set. Capabilities become standard only when materially different apps prove the same portable contract.
- **Consistency:** remove ecosystem, marketplace, global plugin identity, competing-provider, granular-grant, toolbar-as-product, Vite-as-SDK, and annotation-as-Core assumptions from future proposed material after Control Room acceptance.
