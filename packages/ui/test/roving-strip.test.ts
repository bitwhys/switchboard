// Toolbar contract §8.7 (P7) — createRovingStrip.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRovingStrip, type RovingStrip } from "../src/roving-strip";

let host: HTMLElement;
let strip: HTMLElement;
let roving: RovingStrip;

const buttons = (): HTMLButtonElement[] =>
	Array.from(strip.querySelectorAll("button"));

const tabStops = (): HTMLButtonElement[] =>
	buttons().filter((b) => b.tabIndex === 0);

function press(key: string): void {
	const shadow = host.shadowRoot;
	const active = shadow?.activeElement ?? document.activeElement;
	active?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

beforeEach(() => {
	host = document.createElement("switchboard-toolbar");
	document.body.append(host);
	const shadow = host.attachShadow({ mode: "open" });
	strip = document.createElement("div");
	strip.setAttribute("role", "toolbar");
	strip.setAttribute("aria-label", "Switchboard toolbar");
	strip.innerHTML = `
		<button type="button">one</button>
		<button type="button">two</button>
		<div role="separator" aria-orientation="vertical"></div>
		<button type="button">three</button>
	`;
	shadow.append(strip);
	roving = createRovingStrip(strip);
});

afterEach(() => {
	roving.dispose();
	host.remove();
});

describe("createRovingStrip", () => {
	it("§8.7 exactly one tab stop", () => {
		expect(tabStops()).toEqual([buttons()[0]]);
		expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
	});

	it("§8.7 ArrowRight moves focus and the tab stop, skipping separators", () => {
		buttons()[0].focus();
		press("ArrowRight");
		expect(host.shadowRoot?.activeElement).toBe(buttons()[1]);
		press("ArrowRight");
		expect(host.shadowRoot?.activeElement).toBe(buttons()[2]);
		expect(tabStops()).toEqual([buttons()[2]]);
	});

	it("§8.7 arrows wrap around at both ends", () => {
		buttons()[0].focus();
		press("ArrowLeft");
		expect(host.shadowRoot?.activeElement).toBe(buttons()[2]);
		press("ArrowRight");
		expect(host.shadowRoot?.activeElement).toBe(buttons()[0]);
	});

	it("§8.7 Home and End jump to the edges", () => {
		buttons()[1].focus();
		press("End");
		expect(host.shadowRoot?.activeElement).toBe(buttons()[2]);
		press("Home");
		expect(host.shadowRoot?.activeElement).toBe(buttons()[0]);
	});

	it("§8.7 focusing an item by any route makes it the tab stop", () => {
		buttons()[2].focus();
		expect(tabStops()).toEqual([buttons()[2]]);
	});

	it("§8.7 refresh keeps a single tab stop across re-renders", () => {
		const extra = document.createElement("button");
		extra.type = "button";
		extra.textContent = "four";
		strip.append(extra);
		roving.refresh();
		expect(tabStops().length).toBe(1);
		// the pre-existing stop survives
		expect(tabStops()).toEqual([buttons()[0]]);
		expect(extra.tabIndex).toBe(-1);
	});

	it("§8.7 refresh falls back to the first item when the stop was removed", () => {
		const [first] = buttons();
		first.remove();
		roving.refresh();
		expect(tabStops()).toEqual([buttons()[0]]);
	});

	it("dispose stops arrow handling", () => {
		buttons()[0].focus();
		roving.dispose();
		press("ArrowRight");
		expect(host.shadowRoot?.activeElement).toBe(buttons()[0]);
	});
});
