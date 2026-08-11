// Toolbar contract §8.5 (P5) — createAnnouncer.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Announcer, createAnnouncer } from "../src/announcer";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

let host: HTMLElement;
let shadow: ShadowRoot;
let announcer: Announcer;

beforeEach(() => {
	host = document.createElement("switchboard-toolbar");
	document.body.append(host);
	shadow = host.attachShadow({ mode: "open" });
	announcer = createAnnouncer({
		shadowParent: shadow,
		lightParent: document.body,
	});
});

afterEach(() => {
	announcer.dispose();
	host.remove();
});

const regionIn = (root: ParentNode): HTMLElement | null =>
	root.querySelector("[aria-live]");

describe("createAnnouncer", () => {
	it("§8.5 the default live region lives inside the shadow root, polite", async () => {
		const region = regionIn(shadow);
		expect(region).not.toBeNull();
		expect(region?.getAttribute("aria-live")).toBe("polite");
		announcer.announce("Metrics panel opened");
		await settle();
		expect(region?.textContent).toBe("Metrics panel opened");
	});

	it("§8.5 announcements are plain text only — markup never parses", async () => {
		announcer.announce("<b>bold?</b>");
		await settle();
		const region = regionIn(shadow);
		expect(region?.textContent).toBe("<b>bold?</b>");
		expect(region?.children.length).toBe(0);
	});

	it("§8.5 the light-DOM fallback region exists and is switchable at runtime", async () => {
		const lightRegion = regionIn(document.body);
		expect(lightRegion).not.toBeNull();
		expect(lightRegion?.getRootNode()).toBe(document);
		announcer.useFallback(true);
		announcer.announce("Feedback sent");
		await settle();
		expect(lightRegion?.textContent).toBe("Feedback sent");
		expect(regionIn(shadow)?.textContent).toBe("");
	});

	it("§8.5 repeating a message clears first so it re-announces", async () => {
		announcer.announce("Metrics refreshed");
		await settle();
		const region = regionIn(shadow);
		expect(region?.textContent).toBe("Metrics refreshed");
		announcer.announce("Metrics refreshed");
		// synchronously cleared; re-set in a later task
		expect(region?.textContent).toBe("");
		await settle();
		expect(region?.textContent).toBe("Metrics refreshed");
	});

	it("dispose removes both regions", () => {
		announcer.dispose();
		expect(regionIn(shadow)).toBeNull();
		expect(regionIn(document.body)).toBeNull();
	});
});
