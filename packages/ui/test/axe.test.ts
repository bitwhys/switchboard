// Toolbar contract §8 — the standing axe gate: the factories composed into
// a full chrome (the port of prototypes/shadow-panel-a11y/) audit clean
// with panels closed and open, including inside plugin-mounted containers.

import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChrome, type Chrome } from "./harness";

let chrome: Chrome;
let hostPage: HTMLElement;

beforeEach(() => {
	// A minimal well-formed host page (the prototype's had one too):
	// without it axe flags the empty tester page itself, not the chrome.
	hostPage = document.createElement("main");
	hostPage.innerHTML = "<h1>Host page</h1>";
	document.body.append(hostPage);
	chrome = buildChrome();
});

afterEach(() => {
	chrome.dispose();
	hostPage.remove();
});

async function violations(): Promise<string[]> {
	const result = await axe.run(document, { resultTypes: ["violations"] });
	return result.violations.map(
		(v) =>
			`${v.impact}: ${v.id} — ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`,
	);
}

describe("axe gate (§8, panels closed and open)", () => {
	it("§8 zero violations with panels closed", async () => {
		expect(await violations()).toEqual([]);
	});

	it("§8 zero violations with panels open (non-modal), auditing inside mounted containers", async () => {
		chrome.metrics.open();
		chrome.feedback.open();
		expect(chrome.metrics.dialog.open).toBe(true);
		expect(chrome.feedback.dialog.open).toBe(true);
		expect(await violations()).toEqual([]);
	});

	it("§8 zero violations with a modal panel open", async () => {
		chrome.metrics.open({ modal: true });
		expect(chrome.metrics.dialog.matches(":modal")).toBe(true);
		expect(await violations()).toEqual([]);
	});
});
