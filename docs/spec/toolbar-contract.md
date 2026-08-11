# Switchboard Toolbar Adapter Contract

**Version: `toolbar@1.0.0`.** The `toolbar` capability's semver *is* this contract's version — it versions the placement API itself and is deliberately decoupled from any npm package version (§2.2).

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119.

TypeScript signatures and typed-JSON shape blocks in this document are **binding**. Prose qualifies them; it does not override them.

This document is the one place that defines the panel-chrome accessibility pattern set P1–P8 (§8), including the labelled-landmark obligation the spike promoted into the contract. Cross-cutting rules owned elsewhere are cited by link, never paraphrased: the naming grammar, the permission strings, and the plain-JSON rule live in [`kernel-api.md`](./kernel-api.md); bridge exposure mechanics live in [`bridge-protocol.md`](./bridge-protocol.md); the words **loud** and **dev-mode warning** are defined in [`diagnostics.md`](./diagnostics.md). Related document: [`dom-inspector-contract.md`](./dom-inspector-contract.md) (the other capability-owned contract).

*Background (not binding): the resolutions of tickets #7 (toolbar placement API) and #10 (Shadow DOM panel chrome a11y spike), the Shadow DOM accessibility research ([`docs/shadow-dom-a11y-patterns.md`](../shadow-dom-a11y-patterns.md)), and the spike evidence ([`prototypes/shadow-panel-a11y/`](../../prototypes/shadow-panel-a11y/)).*

---

## 1. Scope

This contract binds two parties:

- **Adapters** — any plugin that `provides` the `toolbar` capability and registers the `toolbar` Service. The first-party toolbar package is one such adapter; it holds no special status under this contract.
- **Contributors** — any plugin that consumes the `toolbar` Service to place items or panels.

The kernel carries no placement API: there is no `api.toolbar.*` on `PluginApi`, no manifest field for toolbar contributions, and no toolbar import in `core`. Everything in this document flows through one Service (§3), so the whole placement API is structurally ignorable by applications that install no toolbar.

Out of scope here, because each is defined elsewhere: command semantics, `when`, capabilities, and Disposables ([`kernel-api.md`](./kernel-api.md)); agent exposure of commands ([`bridge-protocol.md`](./bridge-protocol.md)); element identity ([`dom-inspector-contract.md`](./dom-inspector-contract.md)).

v1 trusts plugin code (kernel spec [§1](./kernel-api.md#1-scope)). Nothing in this contract is a security boundary; declared attribution (§4.1, §6.1) is a rule for authors, not something an adapter can verify.

*Consolidates: #7.*

## 2. The capability is the contract

*Consolidates: #7.*

### 2.1 Provision

An adapter declares `provides: ["toolbar@<semver>"]` and registers a Service named `toolbar` — the capability name and the service name coincide, per the kernel convention ([§10.1](./kernel-api.md#101-declarations)). At most one installed adapter provides `toolbar` ([§10.2](./kernel-api.md#102-single-provider)).

The contract belongs to the capability name, not to any implementation: any adapter that honestly provides `toolbar@<semver>` and conforms to this document is a toolbar. Contributors MUST NOT depend on implementation identity — plugins cannot tell conforming adapters apart, and this indistinguishability is a design goal, not an accident.

### 2.2 Versioning

The capability semver versions the placement API itself: the item and panel shapes (§4, §5), the mount contract (§5.2), the ordering semantics (§6), and the chrome obligations (§7–§8).

- **Additive changes** — new optional fields (`slot`, `group`, `preferredSize`, a keep-alive hint, a plugin-facing close API; §10) — are minor version bumps.
- **Breaking changes** are major version bumps, the same bump-on-breaking discipline as the bridge protocol.

There is no third version number, and the npm package version of any adapter is not the contract version: chrome restyles and internal rewrites rev the package, not the capability. Compatibility is enforced at activation by the kernel's existing `satisfies` check with its [loud](./diagnostics.md#21-loud-errors) diagnostic errors ([§10.3](./kernel-api.md#103-the-check)); this contract adds no enforcement machinery of its own.

### 2.3 Consumption

Two approaches, mapping onto the kernel's two service-acquisition paths ([§9](./kernel-api.md#9-services)):

- **Hard dependency** — the plugin cannot function without toolbar presence: declare `requires: ["toolbar@^1"]` and `await api.services.get('toolbar')`. Activation fails [loudly](./diagnostics.md#21-loud-errors) when no toolbar is installed.
- **Soft dependency** — toolbar presence is preferred, not required: probe with `api.services.tryGet('toolbar')` and stay fully functional (headless-safe) when it returns `undefined`. No `requires` entry.

A contributor SHOULD choose the soft approach unless the toolbar is genuinely essential.

## 3. The toolbar service

*Consolidates: #7.*

The `toolbar` Service is the only API for placement.

```ts
interface ToolbarService {
  registerItem(item: ToolbarItem): Disposable      // §4
  registerPanel(panel: PanelDefinition): Disposable // §5
}
```

Both calls return a `Disposable` ([§4.3](./kernel-api.md#43-teardown-disposable)): disposing removes the contribution, and kernel-tracked disposal on plugin deactivation removes every contribution the plugin never explicitly cleaned up. A disposed panel that is currently open MUST be closed through the ordinary close path (§5.2) before its registration is removed.

Malformed contributions MUST be rejected: an item that is neither a command item nor a panel item, a panel with a missing `id`, `title`, or `mount`, or an `id` violating the name grammar. Rejection is [loudly](./diagnostics.md#21-loud-errors) at registration, rejecting that contribution only.

Unknown fields on items and panels MUST be tolerated: preserved, surfaced as a [dev-mode warning](./diagnostics.md#22-dev-mode-warnings), never an error — the same forward-compatibility rule as the kernel ([§15](./kernel-api.md#15-versioning-and-forward-compatibility)). The reserved field names in §4.4 MUST NOT be assigned adapter-specific meanings.

## 4. Items

*Consolidates: #7.*

The strip (§6) accepts exactly two item kinds, plus one property:

```ts
type ToolbarItem = CommandItem | PanelItem

interface CommandItem {
  source: string        // REQUIRED. Contributing plugin id (§4.1)
  command: string       // REQUIRED. A registered command id — the binding (§4.2)
  label?: string        // overrides the command's title in the strip
  icon?: string         // opaque presentation hint; rendering is adapter-defined
  order?: number        // position within the plugin's own cluster (§6.2)
  badge?: BadgeBinding  // §4.3
}

interface PanelItem {
  source: string        // REQUIRED. Contributing plugin id (§4.1)
  panel: string         // REQUIRED. A registered panel id (§5.1)
  label?: string        // overrides the panel's title in the strip
  icon?: string
  order?: number
  badge?: BadgeBinding  // §4.3
}

interface BadgeBinding {
  context: string       // REQUIRED. The Context key that feeds the badge (§4.3)
}
```

An item is `{ command }` or `{ panel }` — an object carrying both, or neither, MUST be rejected [loudly](./diagnostics.md#21-loud-errors). There is no third kind: menus, dropdowns, status-text zones, tabs-within-panels, and custom inline widgets are deliberately absent from v1 (§10).

### 4.1 Attribution

`source` names the contributing plugin's id (plugin-id grammar, [§2.3](./kernel-api.md#23-plugin-ids)) and drives cluster placement (§6.1). It is declared, not verified — v1 trusts plugin code (§1); misattributing `source` violates this contract. A plugin MUST set `source` to its own manifest `id`.

### 4.2 Command items are presentation only

A command item is a strip trigger that binds a registered command; it carries presentation (`label`, `icon`, `order`, `badge`) and nothing else. Behavior, input/output schemas, annotations, and the `when` predicate all live on the command ([§6](./kernel-api.md#6-commands)) — a command item MUST NOT carry behavior or visibility logic of its own, and this contract defines no way for it to.

Binding is by id, resolved live:

- A command item is rendered iff its bound command is currently registered and its `when` predicate (if any) currently evaluates true. The item inherits the command's `when` verbatim — the contract defined at kernel spec [§11](./kernel-api.md#11-visibility-predicates-when) is reused, not redefined; there is no separate item-level `enabledWhen`.
- A `when`-hidden or unregistered command takes its item with it, and the item reappears when the command does. Registration order between an item and its command is therefore immaterial.
- Activating a command item MUST dispatch the bound command exactly as a kernel dispatch with `invocation.source: 'ui'` ([§6](./kernel-api.md#6-commands)) — same validation, same error semantics.

Consequence: anything command-bound in the strip is agent-invocable by construction — the bound command is already eligible for agent exposure under its plugin's own grants ([`bridge-protocol.md`](./bridge-protocol.md)). The strip adds no agent surface and subtracts none (§9).

### 4.3 Badges

A badge is a property of a strip item (command item or panel item) — never a contribution kind. It is fed by a Context key the plugin names in `badge.context`; the adapter observes that key ([§8](./kernel-api.md#8-context) — replay-on-observe makes the initial render synchronous) and re-renders on every write.

The current value selects the rendering:

| Context value | Badge |
|---|---|
| `undefined`, `null`, `false`, or `0` | none |
| `true` | dot |
| a finite number > 0 | count (display formatting is adapter-defined, e.g. `99+`) |
| anything else | none, with a [dev-mode warning](./diagnostics.md#22-dev-mode-warnings) |

The badge MUST fold into the item's accessible name (P7, §8.7). Context values are plain JSON by the kernel's unconditional rule ([§14](./kernel-api.md#14-the-plain-json-rule)); the badge contract adds no constraint of its own.

### 4.4 Reserved fields

`slot` and `group` are reserved item field names. No v1 semantics exist: the strip is the single, implicit region (§6) and cross-plugin grouping is deliberately unsayable (§6.3). When a real second region or grouping scheme arrives, these fields land as minor-version additive changes with absence meaning today's behavior. Adapters MUST NOT assign them other meanings in the interim.

`preferredSize` on panels is reserved on the same terms (§5.3).

## 5. Panels and the mount contract

*Consolidates: #7, #10.*

### 5.1 Panel definition

```ts
interface PanelDefinition {
  source: string   // REQUIRED. Contributing plugin id (§4.1)
  id: string       // REQUIRED. Name grammar; exclusive within the toolbar (§5.1)
  title: string    // REQUIRED. Header title; default strip label for panel items
  icon?: string
  mount(container: HTMLElement): Disposable | void  // §5.2
}
```

Panel ids follow the one kernel name grammar ([§2.1](./kernel-api.md#21-the-name-grammar)) and are exclusive within the toolbar: registering a taken panel id is a [loud error](./diagnostics.md#21-loud-errors). Panel ids are toolbar-local: they are not a kernel name kind ([§2.2](./kernel-api.md#22-name-kinds)) and never reach the bridge. A plugin SHOULD still keep them under its own namespace by the ordinary convention.

A panel item (§4) whose `panel` id has no current registration is not rendered; it appears when the panel registers. Panels are surfaces, not slotted content: a panel with no panel item is legal (it is simply unreachable from the strip in v1).

### 5.2 The mount contract

The mount contract is the framework-agnostic boundary between adapter and panel body: DOM container in, Disposable out; mounted on open, disposed on close.

- **On open**, the adapter MUST call `mount(container)` with a container element that lives inside the toolbar's single open shadow root (P1, §8.1), so panel bodies share the chrome's style isolation. What boots inside the container (vanilla DOM, React, anything) is the plugin's business.
- **On close**, the adapter MUST call the returned `dispose` (when one was returned) and then MUST force-clear the container, in that order. A throwing `dispose` MUST NOT prevent the clear.
- **No keep-alive in v1.** Every open mounts fresh; every close disposes. State that should survive reopening belongs in Context or storage ([§8](./kernel-api.md#8-context), [§13](./kernel-api.md#13-storage)), where it must live anyway to survive a page reload. And MUST NOT be stashed in the mounted DOM. A keep-alive hint, if it ever arrives, is a minor-version additive performance hint (§10).

Open/closed state belongs to the adapter (§7). The adapter MAY close a panel programmatically (e.g. on disposal of its registration, §3), and any programmatic close MUST run the same close path as a user close — dispose, clear, announce, focus restore (§8). No plugin-facing open/close API exists in v1; one is reserved as future-additive (§10).

### 5.3 Plugin obligations inside the container

A plugin may touch only the container it is handed:

- It MUST NOT reach outside its container into chrome DOM or the host page's DOM (host-page access is the business of other permissions and capabilities, not the toolbar).
- ARIA ID references within the panel body are tree-local and legal (the container is inside the chrome's shadow root); references from the body to chrome elements or host-page elements MUST NOT be created (P2, §8.2).
- It MUST NOT retain references to the container or its contents past `dispose` — the adapter force-clears (§5.2).

There is no toolbar-side messaging surface between panel bodies and anything else, and there MUST NOT be one: plugins already have Events and Context, and the toolbar is not a second event system.

## 6. The strip and ordering

*Consolidates: #7.*

The strip is the toolbar's single contributable region in v1, and it is implicit — no `slot` field exists (§4.4). System controls (settings, collapse, the adapter's own controls) are adapter-owned and outside this contract's ordering rules.

### 6.1 Clusters

Items cluster by contributing plugin (`source`, §4.1): each plugin's items render adjacently, and the adapter MUST render a separator between adjacent clusters (P7, §8.7).

**Cluster sequence is plugin activation order** — the same application-developer-owned array the kernel refuses to reorder ([§4.2](./kernel-api.md#42-activation)). Placement disputes between plugins resolve in the application developer's plugin array, not in published packages.

*(Note: an adapter typically derives this order from the order of each plugin's first contribution, which coincides with activation order for contributions made during `setup` — the normal case. An adapter observes kernel registration state through the kernel's public observation surface — [kernel spec §16](./kernel-api.md#16-registry-observation-and-the-plugin-list).)*

### 6.2 Order within a cluster

Within its own cluster an item is positioned by `order?: number`, ascending; absent `order` sorts after present ones; ties break by registration order. A plugin can only fight itself.

### 6.3 Interleaving is unsayable

Cross-plugin interleaving and relative positioning are deliberately inexpressible: no field of this contract lets one plugin's item land inside another plugin's cluster, and none will be added under v1. `group` stays reserved (§4.4) precisely so no adapter improvises one.

## 7. Panel chrome: adapter obligations

*Consolidates: #7, #10.*

**Panel chrome** is everything around a panel's body, and the adapter owns all of it:

- the frame and its sizing and position,
- the header — title, icon, close button,
- open/closed state, including the toggle rendering of panel items (e.g. expanded state),
- focus management: trap, initial focus, restore (§8.3, §8.6),
- `<dialog>` / `inert` semantics (§8.3),
- screen-reader announcements (§8.5).

A plugin may touch only the container it is handed (§5.3). Deliberately absent from v1: plugin size hints (`preferredSize` reserved, §4.4) and any plugin-visible chrome API beyond `mount`.

The chrome obligations in §8 bind every adapter, not just the first-party one: they are what "provides `toolbar@1`" promises, so accessibility is delivered by the shared chrome once, not re-solved per plugin.

*(Note: the first-party [`@switchboard-dev/ui`](../../packages/ui/) package ships headless plain-DOM factories for these chrome mechanisms, which adapters SHOULD build on. What matters is behavior — an adapter meeting §7–§8 without `ui` is fully conformant.)*

## 8. Accessibility: the pattern set P1–P8

This section is the one place that defines the panel-chrome accessibility patterns. They were locked by the Shadow DOM research ([`docs/shadow-dom-a11y-patterns.md`](../shadow-dom-a11y-patterns.md)) and validated end-to-end by the chrome spike ([`prototypes/shadow-panel-a11y/`](../../prototypes/shadow-panel-a11y/)): axe-core 4.10.3 reported 0 violations with panels closed and open — demonstrably auditing inside plugin-mounted containers — and a full VoiceOver walkthrough passed in Safari and Chrome with no extra configuration. NVDA and JAWS remain untested; P5's fallback region exists for exactly that reason.

*Consolidates: #10; evidence also #4.*

*(Note: [`@switchboard-dev/ui`](../../packages/ui/) implements the mechanism of each pattern below except P2, which is a rule honored by construction.)*

### 8.1 P1 — one open shadow root

All chrome lives in a single open shadow root; plugin mount containers live inside it (§5.2). The root MUST be open, not closed (closed roots break the adapter's own ARIA wiring options and shadow-aware tooling and buy no real security), and the adapter MUST NOT nest further shadow roots inside the chrome — a peer or child root cannot be referenced even by element reflection.

### 8.2 P2 — every ARIA reference is tree-local

Every ARIA IDREF (`aria-labelledby`, `aria-describedby`, `aria-controls`, …) MUST have both endpoints inside the chrome's shadow root. Nothing references across the host↔chrome boundary, in either direction. Relationships between chrome and host-page elements are expressed as announcements (§8.5) or visual cues, never as ARIA references.

### 8.3 P3 — panels are native `<dialog>`

A panel's frame is a native `<dialog>` element, in both modes:

- **Modal** (`showModal()`): trapping, top layer, Esc, and inertness of the rest of the page work natively across shadow boundaries — no sentinel elements. Verified caveat, requiring no mitigation: Tab can still reach the browser address bar, a general `<dialog>` property, not a shadow issue.
- **Non-modal** (`show()`): the platform provides nothing — the adapter MUST supply initial focus (the first focusable element in the panel) and its own Esc handling.

Both modes MUST share one close path: the adapter routes modal's `cancel` event into the same code that handles non-modal Esc, the close button, and programmatic close (§5.2), so dispose/clear/announce/restore logic exists exactly once.

### 8.4 P4 — mount, dispose, force-clear

The lifecycle of §5.2, restated as the chrome's obligation: dispose then force-clear on every close. The clear is unconditional — it MUST run even when `dispose` throws or was never returned.

### 8.5 P5 — announcements: shadow-internal live region, light-DOM fallback

State changes a sighted user sees (panel opened/closed, command feedback) MUST be announced via an `aria-live` region inside the shadow root, mutated with plain text only. This placement is the default — VoiceOver speaks it in Safari and Chrome.

The adapter MUST also own a visually-hidden light-DOM fallback live region adjacent to the host element, switchable at runtime, as the escape hatch for screen-reader combinations where the shadow-internal region proves silent (the research found NVDA/JAWS divergence; that matrix is not yet run). The fallback is an adapter feature, invisible to plugins.

### 8.6 P6 — shadow-aware focus bookkeeping

`document.activeElement` reports the shadow host, not the truly focused element; all chrome focus bookkeeping MUST drill via `shadowRoot.activeElement`. On close, focus restore MUST validate its stored target: when the stored element is gone (it may have lived inside the disposed panel) or is `<body>`, the adapter MUST fall back to restoring focus to the panel's toggle.

### 8.7 P7 — strip semantics

The strip is `role="toolbar"` with a roving tabindex (exactly one tab stop) and Arrow-key navigation between items. Separators between plugin clusters (§6.1) are `role="separator"`. An item's badge (§4.3) MUST fold into the item's accessible name (e.g. "Refresh metrics, 3 new"). Panel items MUST convey their popup and expanded state (e.g. `aria-haspopup="dialog"`, `aria-expanded`).

### 8.8 P8 — the labelled landmark

All chrome MUST be wrapped in a labelled complementary landmark (e.g. `<aside aria-label="…">`) inside the shadow root, so screen-reader landmark navigation can both find and skip the toolbar. This obligation was surfaced by the audit, not the design: without it the chrome is invisible to landmark navigation, which is why it is contract, not adapter discretion.

Corollary: the adapter SHOULD append its host element last in the host `<body>`, so DOM order alone places the strip after page content in the tab sequence, with no `tabindex` intervention.

## 9. Agents and the toolbar

*Consolidates: #7.*

**Agents cannot steer the toolbar UI in v1.** Panel visibility is presentation state, and this contract deliberately gives it no command surface:

- An adapter MUST NOT manufacture commands that open, close, or toggle panels (e.g. `toolbar.panel.*.toggle`). Such commands would be registered by the adapter, so a single `bridge:commands` grant on the adapter would flip UI-steering on for every plugin's panels at once, breaking the per-plugin attribution model of the bridge ([`bridge-protocol.md`](./bridge-protocol.md)) — and would pollute the agent tool list with chrome noise.
- The toolbar itself registers nothing agent-facing. The strip's entire agent story is inherited: a command item's bound command is exposed (or not) under its own plugin's grants, exactly as if the item did not exist (§4.2).

Agent UI-steering re-enters, if ever, alongside a future in-page-agent-consumers effort and a bridge design that preserves attribution — outside this contract's v1 scope.

## 10. Versioning and evolution

*Consolidates: #7, #10.*

Recorded futures, all shaped to be minor-version additive under §2.2:

- `slot` — a second contributable region (absent = strip). Arrives only when a real region exists.
- `group` — cross-plugin grouping scheme, if the unsayability of §6.3 is ever deliberately revisited.
- `preferredSize` — a panel size hint.
- A keep-alive hint on panels — relaxing mount-on-open/dispose-on-close as a performance opt-in.
- A plugin-facing programmatic close (and possibly open) API for a plugin's own panels.
- Further item kinds (menus/dropdowns, status text zones, custom inline widgets, tabs-within-panels), each admitted only when a concrete plugin demonstrably cannot be expressed with the two kinds plus badge. (All four v1 reference plugins are expressible without them.)
- Running the remaining screen-reader matrix (NVDA, JAWS) against P5; flipping the default region placement, should the evidence demand it, is a behavioral change inside the adapter and not a contract change — the contract already requires both regions.

The uniform rule matches the kernel ([§15](./kernel-api.md#15-versioning-and-forward-compatibility)): unknown fields tolerated with a [dev-mode warning](./diagnostics.md#22-dev-mode-warnings), reserved names never repurposed, malformed contributions rejected [loudly](./diagnostics.md#21-loud-errors) — rejecting that contribution only.
