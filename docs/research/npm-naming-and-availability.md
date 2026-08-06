# npm naming & availability for Switchboard 0.1.0

> Research for wayfinder #26 (implementation map #24). Checked 2026-08-05 against primary sources: the npm registry (`registry.npmjs.org`), the npm downloads API (`api.npmjs.org`), docs.npmjs.com, blog.npmjs.org, and github.com. All HTTP statuses below were observed on 2026-08-05.
>
> Claims tagged: **[reg]** = registry/API response observed directly, **[docs]** = official npm docs, **[gh]** = github.com HTTP check.

---

## TL;DR + recommendation

**Publish everything under a new free npm org `switchboard-dev` — scope `@switchboard-dev`.** The obvious names are gone: the bare package `switchboard` has been occupied since 2011, and the `@switchboard` scope belongs to an existing (dormant) org. `@switchboard-dev` is available, reads as "Switchboard, the dev tool" — which doubles as disambiguation in a name-space crowded with AI-adjacent "switchboard" projects — and satisfies every npm naming rule.

| Package | npm name |
|---|---|
| kernel/runtime | `@switchboard-dev/core` |
| UI primitives | `@switchboard-dev/ui` |
| toolbar (reference `toolbar@1.0.0` provider) | `@switchboard-dev/toolbar` |
| bridge + MCP edge | `@switchboard-dev/bridge-mcp` |
| Vite adapter | `@switchboard-dev/adapter-vite` |
| Next.js adapter | `@switchboard-dev/adapter-next` |
| reference plugin: headless metrics | `@switchboard-dev/plugin-metrics` |
| reference plugin: DOM inspector | `@switchboard-dev/plugin-dom-inspector` |
| reference plugin: a11y scanner | `@switchboard-dev/plugin-a11y-scanner` |
| reference plugin: feedback & annotations | `@switchboard-dev/plugin-feedback` |
| example apps (never published) | `@switchboard-dev/example-vite`, `@switchboard-dev/example-next` — `"private": true` |

**Fallback order for the scope**, if org creation hits a surprise: `@switchboard-labs` → `@switchboardjs` → `@telestrator-labs` → `@bitwhys` (all confirmed unregistered on npm except `@bitwhys`, which is the maintainer's existing account; see evidence table).

The plugin-name segments follow the briefs' plugin ids (`reference.metrics`, `reference.dom-inspector`, `reference.a11y-scanner`, `reference.feedback` — [`docs/spec/plugins/`](../spec/plugins/)) with the `reference.` publisher segment dropped: on npm, the scope *is* the publisher. Plugin ids and npm names stay decoupled by design — the kernel's `publisher.name` id grammar cannot represent an npm name, which lives in the manifest's optional `package` field ([kernel spec §2.3, §3.1](../spec/kernel-api.md#23-plugin-ids)).

---

## 1. Availability evidence

Method: **package existence** via `curl https://registry.npmjs.org/<name>` (200 = taken, 404 = free). **Scope existence** via `curl https://registry.npmjs.org/-/org/<name>/package` — this unauthenticated endpoint returns 200 with a package map for an existing org *or* user scope and 404 otherwise; validated against controls the same day (org `babel` → 200, user `sindresorhus` → 200, gibberish string → 404) [reg]. A scope is claimable only if **no npm user or org** of that name exists — the org name *is* the scope ([docs: "Your organization name will also be your organization scope"](https://docs.npmjs.com/creating-an-organization)). (npmjs.com HTML pages — `/org/<name>`, `/~<name>` — returned 403 to non-browser clients on 2026-08-05 and were not usable as evidence; the registry endpoint is the primary source here. The npm search API's `scope:` qualifier was also tested and found unreliable — `scope:babel` returns 0 — so it was discarded.)

### Scopes (all checked 2026-08-05)

| Scope | `/-/org/<name>/package` | Verdict |
|---|---|---|
| `@switchboard` | **200** — org exists, owns `@switchboard/web` | **TAKEN** |
| `@switchboard-dev` | 404 | **available** ★ recommended |
| `@switchboard-labs` | 404 | available |
| `@switchboardjs` | 404 | available |
| `@switchboard-js` | 404 | available |
| `@switchboard-io` | 404 | available |
| `@getswitchboard` | 404 | available |
| `@telestrator` | 404 | available |
| `@telestrator-labs` | 404 | available |
| `@swbd` | 404 | available |
| `@bitwhys` | **200** — maintainer's own account | usable (personal) |
| `@switchboard-xyz` | **200** — Solana oracle project | taken (context) |

The `@switchboard` scope holder: org whose sole package is [`@switchboard/web`](https://registry.npmjs.org/@switchboard%2fweb) v0.0.12 — "Instantly launch multiple Dynamics demo environments" (repo `chuanqisun/switchboard`), last published **2020-05-26**, 5 downloads/week [reg]. Dormant, but occupancy alone makes the scope unavailable; npm's [dispute policy](https://docs.npmjs.com/policies/disputes) is not a path to plan a 0.1.0 around.

### Bare (unscoped) names

| Name | Registry status | Verdict |
|---|---|---|
| `switchboard` | **200** — v1.3.0, an event-composition lib, last real publish **2012-12-01** (metadata touched 2022), 12 dl/week | **TAKEN** (dormant, but taken) |
| `switch-board` | 404 — but **blocked anyway** by the moniker rule (punctuation-equivalent to `switchboard`, see §3) | unavailable in practice |
| `switchboardjs` | 404 | available (style discouraged, see §3) |
| `switchboard-dev` | 404 | available — optional defensive stub |

Registry URLs used: `https://registry.npmjs.org/switchboard`, `.../switch-board`, `.../switchboardjs`, `.../switchboard-dev`; scoped checks `https://registry.npmjs.org/@switchboard%2fcore` (404), `@switchboard%2fui` (404), `@switchboard%2fcli` (404), `@switchboard%2fweb` (200) [reg].

### GitHub (secondary; cheap checks only)

| Name | github.com status | Note |
|---|---|---|
| `switchboard` | 200 | taken |
| `switchboard-dev` | 200 | taken — npm scope and GitHub name won't align; repo stays `bitwhys/switchboard` (or a future org) |
| `switchboardjs`, `switchboard-labs`, `telestrator-labs` | 200 | taken (`telestrator-labs` may be the maintainer's own — confirm) |
| `telestrator`, `getswitchboard` | 404 | available |

GitHub-name/npm-scope alignment would be nice but is secondary; the npm scope is the durable public identity of the packages, and `repository` fields point at the real repo regardless.

---

## 2. Collision survey: the "switchboard" neighborhood

`https://registry.npmjs.org/-/v1/search?text=switchboard&size=15` returns **204 packages** (2026-08-05) [reg]. The name is crowded, and — notably — crowded specifically with **AI/agent-tooling projects**:

| Package | Last publish | Downloads/wk | What it is | Confusion risk |
|---|---|---|---|---|
| `@switchboard-xyz/*` (`on-demand`, `common`, `cli`, …) | 2026-07-30 (active) | 21,599 (`on-demand`) | **Switchboard** — Solana oracle protocol, large family | High: an established, active project *named Switchboard* with its own `-xyz` scope |
| `@switchboard-mcp/*` (`core`, `mcp-runtime`) | 2026-07-18 (active) | 36 | "Switchboard" MCP governance/runtime project | **Sharpest risk**: an MCP project called Switchboard, adjacent to our `bridge-mcp` |
| `switchboard-router` | 2026-07-20 (active) | 49 | "local AI routing gateway" CLI | Moderate: AI-tool namespace neighbor |
| `switchboard-cli` | 2026-07-05 (active) | 8 | "governance substrate for AI workflows" | Moderate |
| `@wastedtokens/agent-switchboard` | 2026-07-19 | — | Claude Code channel client | Moderate |
| `@superset-ui/switchboard` | 2024-12-10 | 216,558 | Apache Superset cross-window messaging | Low (different domain, own scope) |
| `switchboard` (bare) | 2012-12-01 | 12 | composite-event listener | Low (dead), but blocks the bare name |
| `ns8-switchboard-*`, `@ns8/*` | 2020 | — | defunct commercial suite | Low |

Downloads via `https://api.npmjs.org/downloads/point/last-week/<pkg>` (week 2026-07-29 → 2026-08-04) [reg].

Consequence: none of these blocks our scoped names, but the survey argues **for** a scope that self-describes the niche. `@switchboard-dev/…` reads as the *dev-tool* Switchboard at a glance, where a bare or generic name would be ambiguous against the oracle protocol and the MCP-governance project. Every serious "switchboard" is already living behind a disambiguating scope (`-xyz`, `-mcp`); `-dev` is ours.

---

## 3. npm rules that shaped the recommendation

- **Name syntax** — ≤ 214 characters *including* the scope; no uppercase for new packages; URL-safe characters only; unscoped names may not start with `.` or `_` ([docs: package.json `name`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#name)) [docs]. Longest proposed name, `@switchboard-dev/plugin-dom-inspector`, is 37 chars — fine.
- **Moniker (typosquat) rule** — new unscoped names identical to an existing package after stripping punctuation are rejected: "If the names are identical without punctuation, we do not allow the package to be created" ([blog.npmjs.org: New package moniker rules](https://blog.npmjs.org/post/168978377570/new-package-moniker-rules.html)) [docs]. So `switch-board`, `switch.board`, `switch_board` are all unpublishable given `switchboard` exists — the registry's 404 on `switch-board` is *not* availability. The rule's own recommended escape hatch is exactly what we're doing: scoped packages.
- **Name guidelines** — unscoped names must not be "spelled in a similar way to another package name" or "confuse others about authorship" ([docs: package name guidelines](https://docs.npmjs.com/package-name-guidelines)) [docs]. This, plus the moniker rule, closes the bare-name route entirely; it also mildly penalizes `@switchboardjs` (package.json docs explicitly advise against `js` in names — "it's assumed that it's js, since you're writing a package.json file").
- **Scopes & orgs** — an org's name is its scope; **free orgs get unlimited public packages** ([docs: creating an organization](https://docs.npmjs.com/creating-an-organization); [about scopes](https://docs.npmjs.com/about-scopes)) [docs]. Scoped packages default to restricted at publish: the pipeline must pass `--access public` (or set `publishConfig.access: "public"` in each package.json — prefer the latter; it can't be forgotten).

## 4. Scheme rationale

- **One scope for everything, reference plugins included.** The four reference plugins are first-party deliverables of the 0.1.0 release — they exist to validate the kernel/bridge feature matrix ([spec README coverage matrix](../spec/README.md)) and version in lockstep with it. Sharing `@switchboard-dev` signals provenance ("these are the official ones") exactly the way `@vitejs/plugin-*` or `@tanstack/*` does. Third-party plugins publish under *their own* scopes — the kernel already anticipates this: plugin ids are `publisher.name` and the npm name is a separate manifest field ([kernel spec §2.3, §3.1](../spec/kernel-api.md#23-plugin-ids)), so nothing about the runtime couples to our scope.
- **`plugin-` prefix, brief-id segment.** `plugin-metrics`, `plugin-dom-inspector`, `plugin-a11y-scanner`, `plugin-feedback` — greppable as a family, and the segment after `plugin-` matches the name half of the brief's plugin id, so npm name ↔ plugin id mapping is mechanical.
- **`example-` prefix, `private: true`, never published.** `@switchboard-dev/example-vite`, `@switchboard-dev/example-next` as workspace packages. Scoping private packages costs nothing and keeps workspace imports uniform; `private: true` is the hard guard against accidental `npm publish` ([docs: package.json `private`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#private)). (The existing spike already follows this shape: `spikes/mcp-bridge-transport/package.json` is `@switchboard/spike-mcp-bridge-transport`, private — its scope placeholder just needs the `-dev` update whenever touched.)
- **Why `-dev` over the alternatives.** `@switchboard-labs` implies an org-brand that doesn't exist; `@switchboardjs` carries the discouraged `js` suffix and a taken GitHub name; `@telestrator-labs` buries the product name (`@telestrator-labs/core` says nothing about Switchboard, and every doc, spec, and README says Switchboard); `@bitwhys` is a personal scope — wrong signal for a project whose litmus is third-party authorability. `-dev` is short, truthful (it's a *dev*-tool runtime), and does disambiguation work against `-xyz`/`-mcp` neighbors for free.

## 5. Open questions for release engineering

1. **Org creation** — who creates the free `switchboard-dev` org on npmjs.com (presumably from the `bitwhys` account), and which accounts get owner/admin? Do it **early**: availability was checked 2026-08-05 and scopes are first-come-first-served.
2. **Publish hygiene** — require 2FA for the org (`npm access`/org settings), decide automation-token vs. **trusted publishing with provenance** (`npm publish --provenance` from GitHub Actions OIDC), and set `publishConfig.access: "public"` in every publishable package.json.
3. **Defensive registrations** — claim the bare `switchboard-dev` name with a stub README pointing at the scope? Claim `@switchboardjs` as a second org? Cheap, but each is an ongoing artifact to maintain; decide deliberately.
4. **GitHub home** — stay `bitwhys/switchboard` for 0.1.0 or move to an org (`telestrator-labs` appears taken — confirm whether it's already ours); update `repository` fields accordingly.
5. **Placeholder cleanup** — research docs and the spike currently write `@switchboard/*` (`docs/research/adapter-next-hosting.md`, `docs/research/schema-authoring-for-commands.md`, `spikes/mcp-bridge-transport/package.json`); sweep to `@switchboard-dev/*` when implementation starts so the first `npm install` copy-paste from our own docs isn't wrong.
