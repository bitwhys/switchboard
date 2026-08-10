---
"@switchboard-dev/core": minor
---

Kernel spec §13: per-plugin storage — `api.storage` as the async JSON-valued area with invisible namespacing, the public `StorageEngine` interface plus the two shipped engines (`localStorageEngine`, key-prefixed and the default, with automatic `memoryEngine` fallback when `localStorage` is missing or throws; `memoryEngine`, Map-backed and non-durable), and the enforced default-closed `storage:use` gate rejecting loudly with `permission-denied`. The `storage` option threads through kernel construction with an `invalid-options` structural gate.
