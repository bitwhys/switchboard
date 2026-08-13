# Architecture Decision Records

ADRs are short notes explaining consequential choices. Use one when the reason behind a decision will matter later; routine implementation choices do not need one.

## Index

| ADR | Status | Decision |
|---|---|---|
| [ADR-0001](0001-separate-tools-from-feedback.md) | Superseded by ADR-0012 | Separate tools from feedback and adopt the core primitives |
| [ADR-0002](0002-origin-to-destination-model.md) | Accepted | Associate origins with destinations, with GitHub as an adapter |
| [ADR-0003](0003-production-capability-boundary.md) | Accepted | Permit presentation inspection and reversible mutation in production |
| [ADR-0004](0004-grants-and-tool-concurrency.md) | Accepted | Separate authorization from risk and default tool concurrency to exclusive |
| [ADR-0005](0005-toolbar-dom-ownership.md) | Accepted | Keep toolbar DOM ownership in the vanilla core |
| [ADR-0006](0006-compatibility-and-plugin-distribution.md) | Superseded by ADR-0012 | Fail closed on compatibility and use explicit npm installation |
| [ADR-0007](0007-v1-framework-delivery-scope.md) | Accepted | Limit v1 framework delivery to manual embedding and Vite |
| [ADR-0008](0008-github-app-authorization.md) | Accepted | Use a GitHub App for the included GitHub adapter |
| [ADR-0009](0009-no-durable-audit-log-in-v1.md) | Accepted | Exclude a durable audit subsystem from v1 |
| [ADR-0010](0010-control-room-integration-process.md) | Accepted | Integrate cross-cutting decisions through the Control Room |
| [ADR-0011](0011-vite-first-portable-app-runtime.md) | Accepted | Make Switchboard a Vite-first portable app runtime |
| [ADR-0012](0012-developer-owned-app-contracts.md) | Accepted | Adopt developer-owned apps and lean portable core contracts |

## House style

- Name files `NNNN-short-title.md`; never reuse a number.
- Keep most ADRs under one page.
- Use only `Proposed`, `Accepted`, or `Superseded by ADR-NNNN`.
- Include only context, decision, and meaningful consequences.
- Mention alternatives or follow-up only when they clarify the decision.
- A workstream may propose an ADR; the Control Room accepts or supersedes it.

Copy [`template.md`](template.md) when useful. It is a prompt, not a form to complete mechanically.
