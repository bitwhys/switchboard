---
"@switchboard-dev/core": minor
---

Kernel spec §10: the activation-time capability check — at most one installed provider per capability name (`duplicate-provider`), the once-per-plugin check before `setup` with near-miss version diagnostics (`capability-unsatisfied`), real semver range-grammar validation of `requires` entries, and the `manifest-drift` warning when a registered service name appears in no plugin's `provides`.
