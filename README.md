# Switchboard

An open-source, pluggable in-application developer tool runtime — a toolbar-shaped surface you compose from plugins, wired so that **coding agents can drive the same tools you can**. A plugin registers commands, events and context in your page; under that plugin's own grants, an MCP-speaking agent sees the commands as tools and can call them against the page you are looking at.

It runs in development only, in your app, alongside it — not a browser extension, not a hosted service.

> **Status: pre-release.** Nothing is published to npm yet. The design is complete and merged (see [`docs/spec/`](docs/spec/)), and the kernel and accessibility primitives are built; the toolbar, the two adapters and the reference plugins are still landing. The snippets below show the settled 0.1.0 shape. Import specifiers for packages whose build slices haven't landed — `toolbar`, `adapter-vite`, `adapter-next`, and the four `plugin-*` packages — are provisional and get confirmed as each package ships.

## How the pieces fit

| Piece | What it does |
| --- | --- |
| **The kernel** (`core`) | Runs in your page. Hosts plugins and owns the four primitives: commands, events, context, services. |
| **Plugins** | Ordinary npm packages (or local files) that register those primitives. The toolbar is itself a plugin. |
| **The adapter** (`adapter-vite` / `adapter-next`) | Hosts the bridge inside your dev server and injects the page-side client. You write zero bridge code. |
| **The bridge** (`bridge-mcp`) | Translates between the page and agents: Switchboard's own protocol page-side, MCP at the agent edge. |

One kernel per browser tab, client-only, dev-only. Full picture: [`docs/architecture/topology.md`](docs/architecture/topology.md).

## Quickstart

### 1. Install

```sh
# Vite
pnpm add -D @switchboard-dev/core @switchboard-dev/adapter-vite @switchboard-dev/toolbar

# Next.js
pnpm add -D @switchboard-dev/core @switchboard-dev/adapter-next @switchboard-dev/toolbar
```

Plus whichever plugins you want — the four reference plugins are `@switchboard-dev/plugin-inspector`, `plugin-scanner`, `plugin-metrics`, `plugin-feedback`.

### 2. Write your setup module

One app-owned file constructs the kernel. This is the only Switchboard code your app contains.

```ts
// src/switchboard.ts
import { createSwitchboard } from "@switchboard-dev/core";
import { toolbar } from "@switchboard-dev/toolbar";
import { inspector } from "@switchboard-dev/plugin-inspector";
import { scanner } from "@switchboard-dev/plugin-scanner";

export const switchboard = createSwitchboard({
  plugins: [toolbar, inspector, scanner],
});
```

`createSwitchboard` is synchronous, and the `plugins` array **is** the activation order — the kernel never reorders it ([kernel §18.1](docs/spec/kernel-api.md#181-signature)). Put the toolbar first: plugins that contribute to it optionally probe for it during their own setup, and the strip's clusters render in this order. The returned instance is a full host door — the same `commands` / `events` / `context` / `services` surfaces plugins get, plus `plugins.list()`, a `diagnostics` channel, `ready`, and `dispose()` ([kernel §18.2](docs/spec/kernel-api.md#182-the-instance)).

The other options — `storage` (defaults to `localStorage`), `dev` (defaults to `true`), `diagnostics.console` — are all optional.

### 3. Turn it on in dev

**Vite.** Add the plugin to your config, then import the setup module behind a dev gate:

```ts
// vite.config.ts
import { switchboard } from "@switchboard-dev/adapter-vite";

export default defineConfig({
  plugins: [switchboard()],
});
```

```ts
// src/main.ts
if (import.meta.env.DEV) import("./switchboard");
```

That's the whole integration. The plugin declares `apply: 'serve'`, so it does not exist during `vite build`, and the gated import is statically eliminated from production bundles ([adapter contract §10](docs/spec/adapter-contract.md#10-switchboard-devadapter-vite-binding)).

**Next.js.** One server-side line starts the bridge:

```ts
// instrumentation.ts
export { register } from "@switchboard-dev/adapter-next";
```

The setup module additionally imports the page bootstrap:

```ts
// src/switchboard.ts
import "@switchboard-dev/adapter-next/client";
import { createSwitchboard } from "@switchboard-dev/core";
// …as above
```

and a client component loads it. The loader takes a thunk, so it has to sit inside a client boundary — function props don't cross the server → client boundary:

```tsx
// app/switchboard-dev.tsx
"use client";
import { SwitchboardDev } from "@switchboard-dev/adapter-next/client";

export function SwitchboardLoader() {
  return <SwitchboardDev load={() => import("@/switchboard")} />;
}
```

```tsx
// app/layout.tsx
<SwitchboardLoader />
```

The effect is what keeps the kernel client-only: client components execute during SSR, effects don't. `SwitchboardDev` owns the dev gate, and the thunk keeps the import specifier in your code so production elimination works. Hand-writing the equivalent three-line `useEffect` component is equally supported ([adapter contract §11.4](docs/spec/adapter-contract.md#114-client-entry)).

### 4. Point your agent at the bridge

The bridge serves MCP over Streamable HTTP on its own fixed port — never your app's port, which drifts. Commit this to your project's MCP client config (`.mcp.json` for Claude Code; the equivalent for other clients):

```jsonc
{
  "mcpServers": {
    "switchboard": {
      "type": "http",
      "url": "http://localhost:${SWITCHBOARD_PORT:-7654}/mcp"
    }
  }
}
```

### 5. What you should see

Run your dev server. In the page, the toolbar strip appears — a shadow-DOM surface outside your app's tree, with one cluster of items per contributing plugin; panel items toggle their panel open.

In your agent, `switchboard` exposes three built-in tools that always work, connected or not — `switchboard.status`, `switchboard.context.read`, `switchboard.events.tail` ([bridge §11](docs/spec/bridge-protocol.md#11-built-in-tools)) — plus one MCP tool per command whose plugin declares the `bridge:commands` permission. Grants are default-closed: a plugin without the grant is invisible to agents, and a command whose `when` predicate is false is not listed ([bridge §3](docs/spec/bridge-protocol.md#3-bridge-grants-mechanics)).

Ask your agent for `switchboard.status` first — it reports whether a page is connected, and why not if it isn't.

### If the port is taken

Switchboard never silently picks a different port: a bridge that moves leaves every configured agent pointing at the old one. It fails loudly and your dev server keeps running. Set `SWITCHBOARD_PORT` (documented fallbacks: 7655, 7656) — one variable drives the adapter, the page and the `.mcp.json` snippet above together. On Next, use `NEXT_PUBLIC_SWITCHBOARD_PORT`, which the page bundle can also read. Details: [adapter contract §6](docs/spec/adapter-contract.md#6-the-bridge-port).

## Packages

| Package | What it is |
| --- | --- |
| [`@switchboard-dev/core`](packages/core/) | The kernel: plugin definition, activation, the four primitives, capabilities, permissions, storage |
| [`@switchboard-dev/ui`](packages/ui/) | Headless accessibility primitives for toolbar chrome (patterns P1–P8), zero runtime deps |
| [`@switchboard-dev/toolbar`](packages/toolbar/) | The reference `toolbar@1.0.0` provider: items, badges, panels, all visual chrome |
| [`@switchboard-dev/bridge-mcp`](packages/bridge-mcp/) | The bridge: wire protocol, the MCP edge, and the browser page client |
| [`@switchboard-dev/adapter-vite`](packages/adapter-vite/) | Vite adapter |
| [`@switchboard-dev/adapter-next`](packages/adapter-next/) | Next.js adapter |
| [`@switchboard-dev/plugin-inspector`](plugins/inspector/) | Reference plugin: the `dom.inspector` provider — element identity, registry, picker |
| [`@switchboard-dev/plugin-scanner`](plugins/scanner/) | Reference plugin: on-demand axe-core accessibility scans |
| [`@switchboard-dev/plugin-metrics`](plugins/metrics/) | Reference plugin: headless Web Vitals telemetry |
| [`@switchboard-dev/plugin-feedback`](plugins/feedback/) | Reference plugin: annotations and the human → agent → human loop |

## Writing a plugin

A plugin is a definition object — a static manifest plus a `setup` function — and nothing about it is privileged: the reference plugins are ordinary packages using the same public API you would.

```ts
import { definePlugin } from "@switchboard-dev/core";

export const hello = definePlugin({
  id: "acme.hello",
  name: "Hello",
  version: "1.0.0",
  permissions: ["bridge:commands"],
  setup(api) {
    api.commands.register({
      id: "acme.hello.greet",
      title: "Greet",
      execute: ({ name }) => `Hello, ${name}!`,
    });
  },
});
```

Start with [`packages/core/README.md`](packages/core/README.md) for the tour and [`docs/spec/kernel-api.md`](docs/spec/kernel-api.md) for the exact rules. A dedicated plugin-authoring guide ships with 0.1.0.

## Documentation

- [**Spec suite**](docs/spec/) — the normative design: kernel API, diagnostics, bridge protocol, adapter contract, the toolbar and `dom.inspector` capability contracts, and the four reference-plugin briefs. When this README and a spec disagree, the spec wins.
- [**Architecture**](docs/architecture/) — the same system in six views: topology, exposure model, components and versioning, lifecycles, bridge flows, the agent feedback loop.
- [**Glossary**](CONTEXT.md) — the project's vocabulary, one definition per term.
- [**Research**](docs/research/) — the evidence the specs cite.

## Working on Switchboard itself

A pnpm + Turborepo monorepo; Node ≥ 20.19.

```sh
pnpm install
pnpm check        # build, typecheck, lint, test
pnpm lint:docs    # every relative doc link and anchor resolves
pnpm lint:specs   # reports RFC 2119 requirement changes in docs/spec
```

Work is planned in the open on the issue tracker — see [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

## License

MIT — see [`LICENSE`](LICENSE). © 2026 George Bockari.
