# @switchboard-dev/core

The Switchboard kernel: an in-page plugin runtime for dev tools that both humans and coding agents can drive. Plugins register **commands**, announce **events**, share **context** and **services**; the kernel wires them together in the browser page, and (via `@switchboard-dev/bridge-mcp` and an adapter) exposes the same commands to agents as MCP tools.

This package is the page-side runtime only — no UI, no network. It has one runtime dependency (`semver`) and never touches `NODE_ENV`: keeping it out of production builds is your bundler gate's job (your adapter's docs show the pattern).

## Install

```sh
pnpm add -D @switchboard-dev/core
```

## Quickstart

```ts
import { createSwitchboard, definePlugin } from "@switchboard-dev/core";

const hello = definePlugin({
  id: "acme.hello",
  name: "Hello",
  version: "1.0.0",
  setup(api) {
    api.commands.register({
      id: "acme.hello.greet",
      title: "Greet",
      execute: ({ name }) => `Hello, ${name}!`,
    });
  },
});

// client code only — one kernel per tab
const switchboard = createSwitchboard({ plugins: [hello] });
await switchboard.ready; // settles always, never rejects
```

`createSwitchboard` is synchronous; the `plugins` array is the activation order. The returned instance is a full host door — the same `commands` / `events` / `context` / `services` surfaces plugins get, plus `plugins.list()`, a `diagnostics` channel, and `dispose()` (the hot-reload and test-isolation escape: dispose, then construct fresh).

## What a plugin can do

Inside `setup(api)`:

- `api.commands` — register and execute named operations; the unit agents invoke as MCP tools. A command's optional `when(ctx)` predicate hides it from listings without disabling it.
- `api.events` — fire-and-forget announcements. No replay.
- `api.context` — named observable values ("what is true right now"), with synchronous replay on observe.
- `api.services` — live in-page values shared between plugins, declared via `provides`/`requires` in the manifest.
- `api.storage` — per-plugin persistent key-value storage (requires the `storage:use` permission).
- `api.diagnostics` — emit on and subscribe to the kernel's diagnostics channel.

Failures are contained per plugin: a bad manifest, a failed capability check, or a throwing `setup` marks that plugin `failed` (see `plugins.list()`) and the rest keep running.

## The exact rules

This README is a tour, not the contract. The normative specs live in the repo:

- [Kernel API](https://github.com/bitwhys/switchboard/blob/main/docs/spec/kernel-api.md) — naming, plugin definition, activation, the four primitives, capabilities, permissions, storage, observation, `createSwitchboard`.
- [Diagnostics](https://github.com/bitwhys/switchboard/blob/main/docs/spec/diagnostics.md) — what "loud" means, the error-code table, dev mode.
- [The full spec suite](https://github.com/bitwhys/switchboard/tree/main/docs/spec) — bridge protocol, toolbar contract, and the reference-plugin briefs.

Every rule in the specs is cited by a conformance test in this package.
