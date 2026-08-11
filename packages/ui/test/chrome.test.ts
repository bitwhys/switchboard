// The factories composed as an adapter would compose them (test/harness.ts):
// cross-pattern behavior the per-factory tests can't see — §5.2 mount
// lifecycle riding the §8.3 close path, §8.6 restore into the §8.7 strip.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deepActiveElement } from "../src/focus";
import { buildChrome, type Chrome } from "./harness";

let chrome: Chrome;

beforeEach(() => {
	chrome = buildChrome();
});

afterEach(() => {
	chrome.dispose();
});

describe("the composed chrome", () => {
	it("§5.2 opening mounts the panel body; closing disposes and force-clears it", () => {
		const container = chrome.shadowRoot.getElementById("mount-metrics");
		expect(container?.children.length).toBe(0);
		chrome.metrics.open();
		expect(container?.querySelector("#m-threshold")).not.toBeNull();
		chrome.metrics.close();
		expect(container?.children.length).toBe(0);
	});

	it("§8.3 Esc closes a non-modal panel through the adapter's close path", () => {
		chrome.metrics.open();
		const active = chrome.shadowRoot.activeElement;
		expect(chrome.metrics.dialog.contains(active)).toBe(true);
		active?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(chrome.metrics.dialog.open).toBe(false);
		expect(chrome.metrics.toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("§8.6 close restores focus to where the user came from", () => {
		chrome.metrics.toggle.focus();
		chrome.metrics.open();
		expect(deepActiveElement()).not.toBe(chrome.metrics.toggle);
		chrome.metrics.close();
		expect(deepActiveElement()).toBe(chrome.metrics.toggle);
	});

	it("§8.6 close falls back to the toggle when no valid restore target was stored", () => {
		// nothing purposeful had focus before the open, so the stored
		// target fails validation and the toggle is the restore point
		chrome.metrics.open();
		chrome.shadowRoot.querySelector<HTMLElement>("#m-refresh")?.focus();
		chrome.metrics.close();
		expect(deepActiveElement()).toBe(chrome.metrics.toggle);
	});

	it("§8.7 the toggle regains the tab stop after focus restore", () => {
		chrome.feedback.toggle.focus();
		chrome.feedback.open();
		chrome.feedback.close();
		expect(chrome.feedback.toggle.tabIndex).toBe(0);
		expect(chrome.strip.querySelectorAll('[tabindex="0"]').length).toBe(1);
	});

	it("§8.7 panel items convey popup and expanded state", () => {
		expect(chrome.metrics.toggle.getAttribute("aria-haspopup")).toBe("dialog");
		expect(chrome.metrics.toggle.getAttribute("aria-expanded")).toBe("false");
		chrome.metrics.open();
		expect(chrome.metrics.toggle.getAttribute("aria-expanded")).toBe("true");
	});
});
