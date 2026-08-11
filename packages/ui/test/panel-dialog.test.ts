// Toolbar contract §8.3 (P3) — createPanelDialog.

import { afterEach, describe, expect, it } from "vitest";
import { createPanelDialog, type PanelDialogHandle } from "../src/panel-dialog";

let dialog: HTMLDialogElement;
let handle: PanelDialogHandle | undefined;

function makeDialog(): HTMLDialogElement {
	dialog = document.createElement("dialog");
	dialog.innerHTML = `
		<button type="button" id="d-close">Close</button>
		<input id="d-input" aria-label="Value" />
	`;
	document.body.append(dialog);
	return dialog;
}

afterEach(() => {
	handle?.dispose();
	handle = undefined;
	dialog?.remove();
});

describe("createPanelDialog", () => {
	it("§8.3 modal mode opens via showModal (top layer, native trap)", () => {
		handle = createPanelDialog(makeDialog());
		handle.show({ modal: true });
		expect(dialog.open).toBe(true);
		expect(dialog.matches(":modal")).toBe(true);
	});

	it("§8.3 modal Esc arrives as cancel and routes through the one close path", () => {
		let closes = 0;
		handle = createPanelDialog(makeDialog(), { onClose: () => closes++ });
		handle.show({ modal: true });
		dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
		expect(dialog.open).toBe(false);
		expect(closes).toBe(1);
	});

	it("§8.3 non-modal mode supplies initial focus to the first focusable element", () => {
		handle = createPanelDialog(makeDialog());
		handle.show();
		expect(dialog.open).toBe(true);
		expect(dialog.matches(":modal")).toBe(false);
		expect(document.activeElement).toBe(dialog.querySelector("#d-close"));
	});

	it("§8.3 non-modal initial focus target is adapter-overridable", () => {
		handle = createPanelDialog(makeDialog(), {
			initialFocus: (d) => d.querySelector<HTMLElement>("#d-input"),
		});
		handle.show();
		expect(document.activeElement).toBe(dialog.querySelector("#d-input"));
	});

	it("§8.3 non-modal Esc is handled by the controller through the same close path", () => {
		let closes = 0;
		handle = createPanelDialog(makeDialog(), { onClose: () => closes++ });
		handle.show();
		dialog.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(dialog.open).toBe(false);
		expect(closes).toBe(1);
	});

	it("§8.3 every route runs the one close path exactly once per close", () => {
		let closes = 0;
		handle = createPanelDialog(makeDialog(), { onClose: () => closes++ });
		handle.show();
		handle.close();
		handle.close(); // already closed — no second run
		expect(closes).toBe(1);
		handle.show({ modal: true });
		dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
		expect(closes).toBe(2);
	});

	it("show while open is a no-op; dispose stops routing", () => {
		let closes = 0;
		handle = createPanelDialog(makeDialog(), { onClose: () => closes++ });
		handle.show();
		handle.show({ modal: true }); // ignored — already open
		expect(dialog.matches(":modal")).toBe(false);
		handle.dispose();
		dialog.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(dialog.open).toBe(true); // listener removed
		expect(closes).toBe(0);
		dialog.close();
	});
});
