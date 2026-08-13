# ADR-0002: Associate remote origins with destinations

- **Status:** Accepted · 2026-08-12
- **Replaces:** Mandatory origin-to-repository association and GitHub Issue termination

## Context

The generic webhook boundary can deliver feedback without understanding repositories. Requiring a repository in the core would unnecessarily exclude adopters using Bitbucket, CI, or an agent-owned receiver.

## Decision

Associate an exact remote origin with a configured feedback destination. The included GitHub adapter requires a GitHub App installation and repository and creates an Issue. An adopter-owned webhook requires neither GitHub nor a repository at the core layer. The project does not promise downstream adapters for Bitbucket or other systems.

## Consequences

The webhook stays portable and GitHub credentials remain outside the core. Destination configuration and result semantics must be defined generically under Q-004 and Q-005.
