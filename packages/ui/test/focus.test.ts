// Toolbar contract §8.6 (P6) — deepActiveElement and restoreFocus.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deepActiveElement, restoreFocus } from "../src/focus";

let host: HTMLElement;
let shadow: ShadowRoot;
let inner: HTMLButtonElement;
let outer: HTMLButtonElement;

beforeEach(() => {
	host = document.createElement("switchboard-toolbar");
	document.body.append(host);
	shadow = host.attachShadow({ mode: "open" });
	inner = document.createElement("button");
	inner.textContent = "inside";
	shadow.append(inner);
	outer = document.createElement("button");
	outer.textContent = "outside";
	document.body.append(outer);
});

afterEach(() => {
	host.remove();
	outer.remove();
});

describe("deepActiveElement", () => {
	it("§8.6 drills through shadowRoot.activeElement to the truly focused element", () => {
		inner.focus();
		expect(document.activeElement).toBe(host); // the lie §8.6 exists for
		expect(deepActiveElement()).toBe(inner);
	});

	it("§8.6 reports light-DOM focus unchanged", () => {
		outer.focus();
		expect(deepActiveElement()).toBe(outer);
	});
});

describe("restoreFocus", () => {
	it("§8.6 restores to a stored element that is still valid", () => {
		restoreFocus(outer, inner);
		expect(deepActiveElement()).toBe(outer);
	});

	it("§8.6 a stored element that is gone falls back to the supplied toggle", () => {
		const gone = document.createElement("button");
		document.body.append(gone);
		gone.remove(); // it lived inside the disposed panel
		restoreFocus(gone, inner);
		expect(deepActiveElement()).toBe(inner);
	});

	it("§8.6 a stored <body> falls back to the supplied toggle", () => {
		restoreFocus(document.body, inner);
		expect(deepActiveElement()).toBe(inner);
	});

	it("§8.6 a null stored target falls back to the supplied toggle", () => {
		restoreFocus(null, inner);
		expect(deepActiveElement()).toBe(inner);
	});
});
