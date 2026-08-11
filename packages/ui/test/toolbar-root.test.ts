// Toolbar contract §8.1 (P1) and §8.8 (P8) — createToolbarRoot.

import { afterEach, describe, expect, it } from "vitest";
import { createToolbarRoot } from "../src/toolbar-root";

let host: HTMLElement | undefined;

function makeHost(): HTMLElement {
	host = document.createElement("switchboard-toolbar");
	document.body.append(host);
	return host;
}

afterEach(() => {
	host?.remove();
	host = undefined;
});

describe("createToolbarRoot", () => {
	it("§8.1 all chrome lives in a single open shadow root", () => {
		const root = createToolbarRoot(makeHost(), { label: "Dev tools" });
		expect(root.shadowRoot.mode).toBe("open");
		expect(root.shadowRoot.host).toBe(host);
		expect(root.landmark.getRootNode()).toBe(root.shadowRoot);
	});

	it("§8.1 a second root on the same host throws natively", () => {
		const el = makeHost();
		createToolbarRoot(el, { label: "Dev tools" });
		expect(() => createToolbarRoot(el, { label: "Again" })).toThrow();
	});

	it("§8.8 the landmark is a complementary landmark with the supplied label", () => {
		const root = createToolbarRoot(makeHost(), {
			label: "Switchboard developer tools",
		});
		expect(root.landmark.tagName).toBe("ASIDE");
		expect(root.landmark.getAttribute("aria-label")).toBe(
			"Switchboard developer tools",
		);
	});

	it("§8.8 an unlabelled landmark is refused (label required)", () => {
		expect(() => createToolbarRoot(makeHost(), { label: "" })).toThrow(
			TypeError,
		);
		expect(() =>
			// biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
			createToolbarRoot(makeHost(), {} as any),
		).toThrow(TypeError);
	});

	it("dispose removes the landmark from the root", () => {
		const root = createToolbarRoot(makeHost(), { label: "Dev tools" });
		root.dispose();
		expect(root.shadowRoot.contains(root.landmark)).toBe(false);
	});
});
