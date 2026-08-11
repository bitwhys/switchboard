# Switchboard Diagnostics Specification

**Version: Kernel API v1.** The diagnostic entry shape, the severity vocabulary, and the kernel- and bridge-owned error codes are kernel API surface and version with it ([kernel spec §15](./kernel-api.md#15-versioning-and-forward-compatibility)); a capability contract's codes version under that capability's semver (§5.3). There is no separate diagnostics version.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119.

TypeScript signatures and typed-JSON shape blocks in this document are **normative**. Prose qualifies them; it does not override them.

This document is the one normative home for what the rest of the suite means by **"loud"**, **"named error"**, and **"dev-mode warning"** — the diagnostics channel, the entry shape, the error-code table, dev mode, and the node-side stderr form. Every other document in the suite uses those words as links to this one and MUST NOT redefine them. Related documents: [`kernel-api.md`](./kernel-api.md), [`bridge-protocol.md`](./bridge-protocol.md), [`toolbar-contract.md`](./toolbar-contract.md), [`dom-inspector-contract.md`](./dom-inspector-contract.md).

*Consolidates (non-normative): the resolution of ticket #37 (the diagnostics model); the `EADDRINUSE` posture of the bridge-port research (#40).*

---

## 1. Scope

Every specification in this suite demands that failures be "loud" and that certain lapses produce a "dev-mode warning." This document defines those words mechanically, once: one kernel-owned **diagnostics channel**, two severities, a stable **code** per diagnostic, and a **stamped attribution** that says who spoke and who is responsible.

The channel is a reporting surface, never control flow: subscribing, unsubscribing, or disabling the console reporter changes what is *observed*, not what *happens*. Thrown errors are control flow and can never be suppressed (§2.1).

The channel exists **page-side only**. The bridge's node side uses the same vocabulary over a different transport — stderr JSON lines (§8).

## 2. Loudness: the two severities

Diagnostic entries carry `severity: 'error' | 'warning'` — exactly the two words the suite uses. The severity decides the mechanics:

### 2.1 Loud errors

A **loud error** is both of, always together:

1. a named error (§3) **thrown** — or, for async surfaces, **rejected** — at the failing call site, and
2. a diagnostic entry with `severity: 'error'` **emitted** on the channel (§6), carrying the same `code` and attribution as the thrown error.

Loud errors are **unconditional**: dev mode (§7) never changes them, and nothing can suppress the throw — "suppress" only ever means unsubscribing from the channel or disabling the console reporter (§6.3). Console output is not the mechanism of loudness; it is the default subscriber.

### 2.2 Dev-mode warnings

A **dev-mode warning** is a channel emission with `severity: 'warning'` — and nothing else. A warning is never control flow: the operation it comments on proceeds unchanged. When dev mode is off (§7), warnings are not emitted at all.

## 3. Named errors: `SwitchboardError`

A **named error** is a `SwitchboardError`:

```ts
class SwitchboardError extends Error {
  name: 'SwitchboardError'
  code: string        // stable, spec-enumerated (§5)
  source: string      // who raised it — same stamping rules as the entry (§4)
  plugin?: string     // the responsible plugin id, when one exists (§4)
  subject?: string    // what the error is about (§4)
  // message: string  — inherited; free-form human prose
}
```

The `code` is the error's identity: conformance tests MUST match on `code` and MUST NOT match on message prose. `message` exists for humans and MAY change without notice.

## 4. The diagnostic entry

Every channel emission is one entry:

```ts
interface Diagnostic {
  severity: 'error' | 'warning'
  code: string        // stable, spec-enumerated (§5)
  source: string      // WHO EMITTED — stamped, never caller-supplied (§4.1):
                      // a plugin id, 'kernel', 'bridge', or 'host'
  plugin?: string     // WHO IS RESPONSIBLE — the plugin the diagnostic is about,
                      // when one exists (§4.2)
  subject?: string    // WHAT it is about: the command id, context key, permission
                      // string, panel id, capability name, … as applicable
  message: string     // free-form human prose — never matched by tests (§3)
  timestamp: number   // emit time, ms since epoch
}
```

### 4.1 `source` is stamped

`source` names the emitter and is **stamped by the kernel — never taken from the caller**: for `api.diagnostics.emit` (§6.2) it is the calling plugin's id; for the kernel's own diagnostics it is `'kernel'`; the page-side bridge client emits as `'bridge'`; the application developer's own emissions (if any) as `'host'`. A plugin cannot speak as anyone but itself.

The three words `kernel`, `bridge`, and `host` are **reserved as sources**: a plugin whose manifest `id` is one of them MUST be rejected with a loud `reserved-namespace` error (the same posture as `switchboard.*`, [kernel spec §2.4](./kernel-api.md#24-prefixes-and-the-reserved-namespace)).

### 4.2 `plugin` is the responsible party

`source` and `plugin` differ exactly when one party reports on another's act. When the toolbar rejects a malformed contribution ([toolbar contract §3](./toolbar-contract.md#3-the-toolbar-service)), the toolbar plugin is the `source` and the **contributor** is the `plugin`. When the kernel rejects a malformed manifest, `source: 'kernel'` and `plugin` names the offender. When they coincide (a plugin reporting its own trouble), both carry the same id.

## 5. The code table

A `code` is a single lowercase kebab segment (`[a-z0-9-]+`), compared exactly. This table is the v1 registry — the **condition** each code names stays defined in its owning section; this document owns only the string.

### 5.1 Kernel codes

| Code | Severity | Condition | Defined by |
|---|---|---|---|
| `invalid-name` | error | a registered name violates the name grammar | [kernel §2.1](./kernel-api.md#21-the-name-grammar), [§6.1](./kernel-api.md#61-registration-and-dispatch) |
| `name-taken` | error | an exclusive name is already registered | [kernel §2.2](./kernel-api.md#22-name-kinds), [§9](./kernel-api.md#9-services) |
| `reserved-namespace` | error | a plugin registration under `switchboard.*`, or a reserved plugin id (§4.1) | [kernel §2.4](./kernel-api.md#24-prefixes-and-the-reserved-namespace) |
| `invalid-manifest` | error | a malformed manifest, including malformed permission and activation strings | [kernel §3.3](./kernel-api.md#33-manifest-validation), [§12.1](./kernel-api.md#121-grammar) |
| `invalid-options` | error | structurally unusable `createSwitchboard` options; thrown before any channel exists, so this code never appears as a channel entry | [kernel §18.3](./kernel-api.md#183-failure-envelope) |
| `duplicate-provider` | error | a second installed plugin provides an already-provided capability | [kernel §10.2](./kernel-api.md#102-single-provider) |
| `capability-unsatisfied` | error | a `requires` entry unsatisfied at the activation check | [kernel §10.3](./kernel-api.md#103-the-check) |
| `setup-failed` | error | a plugin's `setup` threw or rejected | [kernel §4.2](./kernel-api.md#42-activation) |
| `service-unavailable` | error | `services.get` for a name whose capability no installed plugin provides | [kernel §9](./kernel-api.md#9-services) |
| `invalid-input` | error | a command's `validate` returned issues; dispatch refused | [kernel §6.3](./kernel-api.md#63-validation) |
| `command-not-found` | error | `commands.execute` for an id no command is registered under | [kernel §6.1](./kernel-api.md#61-registration-and-dispatch) |
| `command-failed` | error | a command handler threw; wrapped with the command id | [kernel §6.1](./kernel-api.md#61-registration-and-dispatch) |
| `permission-denied` | error | a call gated by an enforced permission the plugin does not hold (v1: `storage:use`) | [kernel §13.5](./kernel-api.md#135-permission-storageuse) |
| `when-failed` | warning | a `when` predicate threw during evaluation; contained, the command treated as not listed | [kernel §11.1](./kernel-api.md#111-the-tracked-read-context-view) |
| `duplicate-kernel` | warning | a second kernel announced while a first is live; first live kernel wins | [kernel §17.2](./kernel-api.md#172-first-live-kernel-wins) |
| `unknown-manifest-field` | warning | an unknown manifest field, tolerated | [kernel §3.3](./kernel-api.md#33-manifest-validation) |
| `unknown-activation-hint` | warning | an unknown activation hint, behaviorally ignored | [kernel §4.1](./kernel-api.md#41-activation-hints) |
| `unknown-permission` | warning | an unknown permission string, tolerated, granting nothing | [kernel §12.2](./kernel-api.md#122-the-v1-vocabulary--eight-strings) |
| `manifest-drift` | warning | a registered service name appears in no plugin's `provides` | [kernel §10.4](./kernel-api.md#104-manifest-drift-warning) |

### 5.2 Bridge codes

| Code | Severity | Condition | Defined by |
|---|---|---|---|
| `wire-illegal` | error | a value failed strict JSON serialization at the wire, attributed to the acting plugin | [bridge §12](./bridge-protocol.md#12-the-wire-legal-enforcement-point) |
| `malformed-message` | error | a malformed wire message | [bridge §4.3](./bridge-protocol.md#43-tolerance-posture) |
| `protocol-mismatch` | error | the handshake was rejected on protocol-version mismatch; remedy: reload the tab | [bridge §5.3](./bridge-protocol.md#53-rejection) |
| `port-in-use` | error | node-side (§8): the bridge's port is already bound (`EADDRINUSE`); the bridge MUST refuse to serve rather than scan — the hosting dev server survives | [adapter contract §6.3](./adapter-contract.md#63-eaddrinuse-fail-loud-never-scan) |
| `unknown-wire-data` | warning | an unknown wire message type or field, tolerated | [bridge §4.3](./bridge-protocol.md#43-tolerance-posture) |

### 5.3 Capability-contract codes

Codes introduced by a capability contract version under that capability's semver and are registered here so the suite has one lookup surface:

| Code | Severity | Condition | Defined by |
|---|---|---|---|
| `invalid-contribution` | error | a malformed toolbar contribution — neither/both of `command` and `panel`, missing required fields, a grammar-violating id | [toolbar §3](./toolbar-contract.md#3-the-toolbar-service), [§4](./toolbar-contract.md#4-items) |
| `unknown-contribution-field` | warning | an unknown field on an item or panel, tolerated | [toolbar §3](./toolbar-contract.md#3-the-toolbar-service) |
| `invalid-badge-value` | warning | a badge context value outside the badge table; rendered as no badge | [toolbar §4.3](./toolbar-contract.md#43-badges) |
| `stale-reference` | error | an ElementReference whose node was collected or whose id is unknown to the registry | [dom.inspector §3.2](./dom-inspector-contract.md#32-the-single-failure-stale-reference) |

`name-taken` and `invalid-name` are **reused** by capability contracts where their conditions recur (e.g. toolbar panel-id exclusivity, [toolbar §5.1](./toolbar-contract.md#51-panel-definition)) — same condition, same code, different emitter.

## 6. The channel

One kernel-owned channel carries every entry. Like Events ([kernel spec §7](./kernel-api.md#7-events)) it is **strictly ephemeral**: no replay, no buffering — a late subscriber missed it. (The console reporter subscribes at construction, so it misses nothing.)

Delivery MUST reach every current subscriber; a throwing subscriber MUST NOT prevent delivery to the others and MUST NOT affect the operation the diagnostic reports on.

### 6.1 The host surface

The kernel instance returned by `createSwitchboard` exposes the channel (the instance's full shape: [kernel spec §18.2](./kernel-api.md#182-the-instance)):

```ts
interface DiagnosticsChannel {
  subscribe(cb: (d: Diagnostic) => void): Disposable
}

// on the kernel instance:
//   switchboard.diagnostics: DiagnosticsChannel
```

The host subscribes to route diagnostics into its own logger; disabling the console reporter (§6.3) is the usual companion move. The channel always fires regardless of subscribers — "suppress" means unsubscribing or ignoring, never silencing the source.

### 6.2 The plugin surface: `api.diagnostics`

`PluginApi` ([kernel spec §5](./kernel-api.md#5-pluginapi)) carries the same channel plus emission:

```ts
interface DiagnosticsApi {
  emit(d: {
    severity: 'error' | 'warning'
    code: string
    plugin?: string
    subject?: string
    message: string
  }): void            // source and timestamp are stamped by the kernel (§4.1)
  subscribe(cb: (d: Diagnostic) => void): Disposable
}
```

- **Emit** exists because service-providing plugins do their own validation: the toolbar's contract-mandated loud rejection of a malformed contribution happens inside an ordinary service call, where the kernel is not in the middle. `emit` is the *emission half* only — a plugin raising a loud error additionally throws its own `SwitchboardError` (§2.1) from the failing call; `emit` never throws. The kernel stamps `source` with the calling plugin's id, unconditionally.
- **Subscribe** has **full cross-plugin visibility**: every subscriber sees every entry, whoever emitted it — consistent with v1's trusted-plugin posture ([kernel spec §1](./kernel-api.md#1-scope)), and sufficient for a future diagnostics panel with no new API.
- Warning emissions via `emit` obey dev mode like every other warning (§7): with dev off they are dropped, not delivered.

### 6.3 The default console reporter

A built-in reporter is the channel's default subscriber: `severity: 'error'` → `console.error`, `'warning'` → `console.warn`. Output SHOULD include the `code` and the attribution; the exact format is not part of this contract.

The host disables it at construction:

```ts
createSwitchboard({ diagnostics: { console: false } })
```

The reporter is active **iff** dev mode is on (§7) **and** `diagnostics.console` is not `false`. Disabling it changes console output only — the channel fires and loud errors throw regardless.

## 7. Dev mode

Dev mode is a kernel construction option, **default on**:

```ts
createSwitchboard({ dev?: boolean })   // default: true
```

Switchboard's presence in a page is itself the dev signal — stripping it from production builds is the adapters' job — so the kernel defaults to `true`. Adapters MAY pass an explicit value from their own environment; `core` itself MUST NOT sniff `NODE_ENV`, `import.meta.env`, or any other environment marker (it is bundler-agnostic).

When dev is **off**: warnings (§2.2) are not emitted, and the console reporter (§6.3) is off. Nothing else changes — loud errors still throw **and** still emit on the channel. Loud errors are unconditional; warnings are dev-only.

## 8. The node side: stderr JSON lines

The channel is page-side only. On the bridge's node side, **"loud" means the diagnostic written to stderr as JSON lines**: one JSON object per line, carrying the same shape as §4 — `severity`, `code`, `source`, `plugin`, `subject`, `message`, `timestamp` — and the process additionally crashing where a spec says so (e.g. `port-in-use`, §5.2).

One vocabulary, two transports; there is no second normative home. How adapters surface or relay the stderr stream is adapter-contract territory, not this document's.

## 9. Versioning and forward compatibility

- **New codes and new severities are additive.** Kernel and bridge codes land as kernel API semver events; capability-contract codes land as minor bumps of their capability (§5.3). Subscribers MUST tolerate entries with unknown `code` or `severity` values.
- **The entry shape evolves additively**: new optional fields MAY appear; subscribers MUST tolerate unknown fields — the suite's uniform posture ([kernel spec §15](./kernel-api.md#15-versioning-and-forward-compatibility)).
- A `code`, once published, is **stable**: renaming or removing one is a breaking change of its owning surface.
