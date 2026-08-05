# Shadow DOM panel chrome a11y spike

Prototype for [switchboard#10](https://github.com/bitwhys/switchboard/issues/10): can managed
panel chrome inside Shadow DOM deliver accessibility by default, and which concrete patterns
should the shared UI package standardize on?

Validates the panel-chrome ownership list from the toolbar placement resolution
([#7](https://github.com/bitwhys/switchboard/issues/7) §5) using the patterns locked by the
Shadow DOM research ([#4](https://github.com/bitwhys/switchboard/issues/4),
[`docs/shadow-dom-a11y-patterns.md`](../../docs/shadow-dom-a11y-patterns.md)).

## Run it

```sh
python3 -m http.server 8931   # from this directory
open http://localhost:8931/
```

Everything is one dependency-free `index.html` (axe-core comes from a CDN, spike-only). The
host page has deliberately hostile styling and its own form, so style isolation and the
host↔chrome tab-order seam are exercised for real.

## The patterns (proposed for the shared UI package)

| # | Pattern | Status |
|---|---|---|
| P1 | Single **open** shadow root for all chrome; plugin containers live inside it | ✅ validated |
| P2 | Every ARIA IDREF is tree-local; nothing references across the host↔chrome seam | ✅ validated (axe clean) |
| P3 | Panel = native `<dialog>`. `showModal()` traps natively; `show()` (non-modal) needs manual initial focus + own Esc handling — both routes share one close path (`cancel` event forwarded) | ✅ validated |
| P4 | Mount contract: `mount(container) → dispose`; adapter runs dispose then **force-clears** the container on close | ✅ validated |
| P5 | Announcements via `aria-live` region **inside** the shadow root, plain-text updates only; adapter also owns a visually-hidden **light-DOM fallback** region (toggleable here for SR comparison) | ✅ mechanics validated; SR verdict pending (HITL) |
| P6 | Focus bookkeeping drills through `shadowRoot.activeElement` (`deepActiveElement()`); focus restore prefers the origin element but falls back to the panel's toggle when the origin was disposed or is `<body>` | ✅ validated |
| P7 | Strip = `role="toolbar"` with roving tabindex + Arrow-key navigation; separators are `role="separator"` between plugin clusters | ✅ validated |
| P8 | All chrome wrapped in a labelled `<aside>` (complementary landmark) inside the shadow root, so SR landmark navigation can find and skip the toolbar | ✅ added after axe flagged chrome as landmark-less |

## Automated evidence (Chrome 2026-08-05, axe-core 4.10.3)

- **axe: 0 violations** with panels closed *and* with a panel open (browser-extension noise excluded). axe traverses the open shadow root — it caught a color-contrast failure *inside plugin-mounted content* during development, proving audits reach managed containers.
- **Tab order across the seam**: host email → host submit → strip (roving tabindex exposes exactly one strip stop) → panel content when open → spike controls. Verified with trusted key events and a focus logger.
- **Arrow-key roving** cycles the strip in both directions.
- **Non-modal open** (`show()`): focus moves to the panel close button; Tab walks header → mounted form; **Esc** closes, disposes, clears the container, and restores focus to the toggle.
- **Modal open** (`showModal()`): 5 consecutive Tabs cycle strictly inside the dialog (native trap, no sentinels); Esc arrives as `cancel` and routes through the same close path; focus restore intact.
- **Programmatic close** (plugin's "Send feedback" button): panel closes, container clears, focus restored to the toggle.
- **Live region text lands**: "Feedback panel opened" / "Feedback sent" observed in the shadow live region.

## Screen-reader script (the HITL half — pending)

VoiceOver (macOS), Safari **and** Chrome. Toggle the two spike checkboxes to cover the matrix
(modal × live-region-placement):

1. **Landmark discovery** — Rotor → Landmarks: is "Switchboard developer tools" listed as a complementary landmark? Can you skip past it back into page content?
2. **Strip semantics** — Tab into the strip: VO should announce "Switchboard toolbar, toolbar" context and "Refresh metrics, button". Arrow through: "Metrics panel, button" / "Feedback panel, button", with popup (haspopup=dialog) and expanded state conveyed.
3. **Panel open, non-modal** — Enter on "Metrics panel": do you hear the live announcement "Metrics panel opened" *and* "Close Metrics panel, button"? Is dialog context ("Metrics, web dialog") announced?
4. **Mounted form** — Tab through: "Metric, pop-up button", "Alert threshold, …" with the hint text ("Announces when the metric exceeds this value") read via `aria-describedby`.
5. **Command + badge** — Activate "Refresh now" then "Refresh metrics" in the strip: is "Metrics refreshed, N total" announced each time? Does the strip button's name now include the count?
6. **Close** — Esc: "Metrics panel closed" announced, focus lands back on "Metrics panel, button" (VO should say so).
7. **Modal mode** — Check "Open panels modally", repeat 3–6: VO must not reach host-page content while the panel is open (VO+arrow reading confined by inertness).
8. **Live region placement** — Repeat 3 and 5 with "Announce via light-DOM fallback region" checked. Record any combo where the **shadow** live region stays silent — that decides whether the fallback is an escape hatch or the default.
9. **Feedback flow** — Open Feedback, type, "Send feedback": "Feedback sent" announced, focus restored.

Record results per combo (SR × browser × modal × region placement); the P5 verdict comes from step 8.

## Notes / edges found while building

- `<dialog>.show()` gives you **nothing** for free: no autofocus, no Esc, no trap. The adapter must focus the first focusable and handle Esc itself. `showModal()` gives all three; the spike routes its `cancel` event into the shared close path so state/announce/restore logic exists once.
- Focus restore must be validated, not just stored: the stored element can be gone by close time (it may have been *inside* the disposed panel), and `<body>` is a useless restore target. Fallback to the toggle.
- The landmark wrapper (P8) came out of the audit, not the design — without it the chrome is invisible to landmark navigation. Worth putting in the adapter contract, not leaving to chance.
- The chrome host element should be appended last in the host `<body>` so DOM order puts the strip after page content in the tab sequence (no `tabindex` games needed).
