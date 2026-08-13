# ADR-0006: Fail closed on compatibility and install plugins explicitly

- **Status:** Accepted · 2026-08-12
- **Replaces:** Implicit npm discovery and ambiguous single-version behavior

## Context

Manifest schema, bridge protocol, and package API versions govern different boundaries. npm keywords do not load packages, and Chrome MV3 does not permit arbitrary remote executable plugin code.

## Decision

Treat bridge protocol, manifest schema, and package API compatibility as separate checks. Support exactly one active manifest schema version and fail before partial registration. Use SemVer/package ranges for package compatibility. Plugins are ordinary npm dependencies explicitly installed and imported by adopters; naming and keywords aid human discovery only.

## Consequences

Compatibility failures are explicit and deterministic. Manifest upgrades may require coordinated plugin releases, and the standalone extension cannot load arbitrary third-party code dynamically.
