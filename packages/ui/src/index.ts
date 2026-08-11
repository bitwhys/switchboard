// @switchboard-dev/ui — headless a11y primitives for toolbar adapters:
// plain-DOM factories for the panel-chrome pattern set P1–P8
// (docs/spec/toolbar-contract.md §8). P2 — every ARIA reference is
// tree-local — is a rule honored by construction, not an export.

export type { Announcer, AnnouncerOptions } from "./announcer";
export { createAnnouncer } from "./announcer";
export type { Disposable } from "./disposable";
export { deepActiveElement, restoreFocus } from "./focus";
export type { MountCleanup, MountController, MountFn } from "./mount";
export { createMountController } from "./mount";
export type { PanelDialogHandle, PanelDialogOptions } from "./panel-dialog";
export { createPanelDialog } from "./panel-dialog";
export type { RovingStrip, RovingStripOptions } from "./roving-strip";
export { createRovingStrip } from "./roving-strip";
export type { ToolbarRoot, ToolbarRootOptions } from "./toolbar-root";
export { createToolbarRoot } from "./toolbar-root";
