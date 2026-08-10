import { describe, expect, it } from "vitest";
import { createBridge } from "../src/node/core";
import {
	connectDemoPage,
	demoCommands,
	FakePage,
	installDemoHandlers,
} from "./harness";

// Bridge spec §13 — one logical surface over an active-tab model — and
// §9.2 — the bounded tail buffer with tab attribution and sequence cursor.

describe("bridge §13 active tab and multi-tab", () => {
	it("§13.3: every connection gets its own stable bridge-minted tab id", () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const a = connectDemoPage(bridge);
		const b = connectDemoPage(bridge);
		expect(a.tabId).toBeTruthy();
		expect(b.tabId).toBeTruthy();
		expect(a.tabId).not.toBe(b.tabId);
	});

	it("§13.2: the most recently connected tab is active until focus says otherwise", () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const a = connectDemoPage(bridge);
		const b = new FakePage(bridge);
		installDemoHandlers(b);
		b.connect();
		b.snapshot(demoCommands().slice(0, 1)); // b announces only demo.echo
		expect(bridge.status().page.activeTabId).toBe(b.tabId);
		expect(bridge.listCommands().length).toBe(1);
		// §13.2 — focus flips the active tab; the surface follows as a diff.
		a.focus();
		expect(bridge.status().page.activeTabId).toBe(a.tabId);
		expect(bridge.listCommands().length).toBe(4);
	});

	it("§13.2: when the active tab disconnects, the bridge fails over to the remaining tab", () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const a = connectDemoPage(bridge);
		const b = new FakePage(bridge);
		b.connect();
		b.snapshot(demoCommands().slice(0, 2));
		expect(bridge.status().page.activeTabId).toBe(b.tabId);
		b.disconnect();
		expect(bridge.status().page.activeTabId).toBe(a.tabId);
		expect(bridge.listCommands().length).toBe(4);
		bridge.dispose();
	});

	it("§13.1: invocations and context reads target the active tab", async () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const a = connectDemoPage(bridge);
		a.setContext("who", "tab-a");
		const b = connectDemoPage(bridge);
		b.setContext("who", "tab-b");
		expect(await bridge.readContext("who")).toMatchObject({ value: "tab-b" });
		a.focus();
		expect(await bridge.readContext("who")).toMatchObject({ value: "tab-a" });
	});
});

describe("bridge §9.2 the tail buffer", () => {
	it("enforces its capacity as a ring — oldest entries fall off", () => {
		const bridge = createBridge({ tailBufferSize: 100, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		for (let i = 1; i <= 120; i++) page.pushEvent("demo.tick", { i });
		const all = bridge.tailEvents(200);
		expect(all.length).toBe(100);
		expect((all[0]?.payload as { i: number } | undefined)?.i).toBe(21);
	});

	it("entries carry a monotonic sequence and the originating tab id", () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		page.pushEvent("demo.one");
		page.pushEvent("demo.two");
		const [one, two] = bridge.tailEvents(10);
		expect(two && one && two.seq > one.seq).toBe(true);
		expect(one?.tabId).toBe(page.tabId);
	});

	it("§11.3: the since-sequence cursor lets agents poll incrementally", () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		page.pushEvent("demo.a");
		const [a] = bridge.tailEvents(10);
		page.pushEvent("demo.b");
		const fresh = bridge.tailEvents(10, a?.seq);
		expect(fresh.map((e) => e.name)).toEqual(["demo.b"]);
	});

	it("§9.2: the buffer survives its page's disconnection", () => {
		const bridge = createBridge({ gracePeriodMs: 10, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		page.pushEvent("demo.kept");
		page.disconnect();
		expect(bridge.tailEvents(10).map((e) => e.name)).toContain("demo.kept");
		bridge.dispose();
	});
});
