# @switchboard-dev/ui

Headless accessibility primitives for [Switchboard](https://github.com/bitwhys/switchboard) toolbar adapters: plain-DOM factory functions implementing the panel-chrome pattern set **P1–P8** from the [toolbar contract](https://github.com/bitwhys/switchboard/blob/main/docs/spec/toolbar-contract.md) §8 — shadow-root setup, native `<dialog>` panels with one close path, the mount/dispose/force-clear lifecycle, live-region announcements, shadow-aware focus bookkeeping, and the roving-tabindex strip.

**Headless means headless**: no chrome, no styles, no framework, zero runtime dependencies. This package carries the *mechanisms*; an adapter (like `@switchboard-dev/toolbar`) supplies all visual chrome and composes them. The patterns themselves are the only normative obligations — an adapter that satisfies §7–§8 without this package is fully conformant; this package is the recommended way to satisfy them once instead of re-solving them.

## Install

```sh
pnpm add -D @switchboard-dev/ui
```

## What's in the box

| Export | Pattern | Mechanism |
| --- | --- | --- |
| `createToolbarRoot(host, { label })` | P1 + P8 | One open shadow root; all chrome inside a labelled `<aside>` landmark |
| `createPanelDialog(dialog, { onClose })` | P3 | Native `<dialog>` in both modes, every close route funneled into one close path; non-modal gets initial focus + Esc |
| `createMountController(container)` | P4 | `mount(fn)` on open; `unmount()` disposes then **force-clears**, even when dispose throws |
| `createAnnouncer({ shadowParent, lightParent })` | P5 | Shadow-internal polite live region, plain text only, plus the switchable light-DOM fallback region |
| `deepActiveElement()` / `restoreFocus(stored, fallback)` | P6 | Focus drilled through `shadowRoot.activeElement`; restore validated with fallback to the toggle |
| `createRovingStrip(strip)` | P7 | Exactly one tab stop, Arrow/Home/End navigation, separators skipped |

P2 — every ARIA reference is tree-local — is a rule you honor by construction, not an export.

## Sketch

```ts
import {
  createMountController,
  createPanelDialog,
  createToolbarRoot,
  deepActiveElement,
  restoreFocus,
} from "@switchboard-dev/ui";

const host = document.createElement("my-toolbar");
document.body.append(host); // last in <body> — P8's tab-order corollary

const { shadowRoot, landmark, } = createToolbarRoot(host, { label: "My dev tools" });
landmark.innerHTML = `<div role="toolbar" aria-label="My toolbar">…</div>
  <dialog aria-labelledby="t"><h2 id="t">Panel</h2><div id="body"></div></dialog>`;

const dialog = landmark.querySelector("dialog")!;
const mounter = createMountController(landmark.querySelector("#body")!);
let cameFrom: Element | null = null;

const panel = createPanelDialog(dialog, {
  onClose() {
    mounter.unmount();                     // dispose, then force-clear
    restoreFocus(cameFrom, toggleButton);  // validated restore
  },
});

function openPanel(mount: (c: HTMLElement) => () => void) {
  cameFrom = deepActiveElement();
  mounter.mount(mount);
  panel.show(); // or panel.show({ modal: true })
}
```

Every factory returns a handle with `dispose()`; disposing tears down only what the factory itself created.

## Conformance

The suite runs in a real browser (Vitest Browser Mode, Chromium) with §-citing tests per pattern, plus a standing [axe-core](https://github.com/dequelabs/axe-core) gate over the fully composed chrome — panels closed, open, and modal — inherited from the validating spike. See the [toolbar contract](https://github.com/bitwhys/switchboard/blob/main/docs/spec/toolbar-contract.md) for the exact rules.
