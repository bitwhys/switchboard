---
"@switchboard-dev/core": minor
---

Kernel spec §11 + §16–§18: the host surface — public `createSwitchboard` with the synchronous construction contract (`plugins` array as activation order, `ready` that never rejects, `dispose()` as full teardown plus announce retraction, the `invalid-options`-only throw envelope); the instance as a full host door with `host`-attributed acts; the `globalThis.__SWITCHBOARD__` handoff (order-independent push/subscribe, `retract`/`onRetract`, first live kernel wins with a `duplicate-kernel` dev-mode warning); `commands.observe` full-array snapshots driven by §11's tracked-read `when` evaluation; and `plugins.list()` — both read surfaces on both doors, grant-agnostic.
