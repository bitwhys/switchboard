# ADR-0008: Use a GitHub App for the included GitHub adapter

- **Status:** Accepted · 2026-08-12
- **Replaces:** “GitHub OAuth App / GitHub App” ambiguity

## Context

Repository installations, selected-repository access, revocation, and short-lived installation tokens are GitHub App concepts, not GitHub OAuth App semantics.

## Decision

Use a GitHub App for the included GitHub Issue adapter. Request least privilege and mint short-lived installation tokens. GitHub credentials remain in the adapter and are never sent to the generic dispatcher or browser extension.

## Consequences

Repository authorization, revocation, and token lifecycle use GitHub-native primitives. Operators must configure and protect a GitHub App identity.
