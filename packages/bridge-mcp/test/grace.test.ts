import { describe, expect, it } from "vitest";
import { createBridge } from "../src/node/core";
import { connectDemoPage, demoCommands, sleep } from "./harness";

// Bridge spec §14 — page absence and reconnection: commands stay listed for
// the grace period, an ordinary reload reconnects inside it with zero
// agent-visible churn, and only a genuinely absent page shrinks the list.

describe("bridge §14.2 the grace period", () => {
	it("commands remain listed while the grace period runs", () => {
		const bridge = createBridge({ gracePeriodMs: 200, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		page.disconnect();
		expect(bridge.listCommands().length).toBe(4);
		bridge.dispose();
	});

	it("calls landing in the gap get the actionable error, never a protocol-level miss", async () => {
		const bridge = createBridge({ gracePeriodMs: 200, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		page.disconnect();
		const outcome = await bridge.invoke("demo.echo", { message: "hi" });
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toContain("no page connected");
		bridge.dispose();
	});

	it("a reconnect inside the grace period re-announcing an identical snapshot causes zero churn", async () => {
		const bridge = createBridge({ gracePeriodMs: 200, diagnostics: () => {} });
		let notifications = 0;
		bridge.addListener({ onRegistryChanged: () => notifications++ });
		const page = connectDemoPage(bridge);
		await sleep(60);
		const before = notifications;
		page.disconnect();
		const reloaded = connectDemoPage(bridge); // §14.3 — fresh hello + snapshot
		await sleep(250);
		expect(notifications).toBe(before);
		expect(bridge.listCommands().length).toBe(4);
		expect(reloaded.tabId).not.toBe(page.tabId);
		bridge.dispose();
	});

	it("only a genuinely absent page shrinks the list, after the grace period expires", async () => {
		const bridge = createBridge({ gracePeriodMs: 50, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		page.disconnect();
		await sleep(120);
		expect(bridge.listCommands()).toEqual([]);
		bridge.dispose();
	});

	it("§14.3: reconnection is a fresh handshake — a new tab id, no resumption", () => {
		const bridge = createBridge({ gracePeriodMs: 50, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		const firstTab = page.tabId;
		page.disconnect();
		const again = connectDemoPage(bridge);
		expect(again.tabId).toBeTruthy();
		expect(again.tabId).not.toBe(firstTab);
		expect(again.helloOk).not.toBeNull();
		bridge.dispose();
	});

	it("§14.1: with no page the status endpoint still tells the whole truth", async () => {
		const bridge = createBridge({ gracePeriodMs: 10, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		page.pushEvent("demo.before-death");
		page.disconnect();
		await sleep(50);
		const status = bridge.status();
		expect(status.page.connected).toBe(false);
		expect(status.hint).toBeTruthy();
		// §11.3 — the tail keeps serving events recorded before the disconnect.
		expect(bridge.tailEvents(10).map((e) => e.name)).toContain(
			"demo.before-death",
		);
		bridge.dispose();
	});
});

describe("bridge §6.1 snapshot debounce interplay", () => {
	it("a reload that lands a DIFFERENT snapshot is one honest delta", async () => {
		const bridge = createBridge({ gracePeriodMs: 200, diagnostics: () => {} });
		let notifications = 0;
		bridge.addListener({ onRegistryChanged: () => notifications++ });
		const page = connectDemoPage(bridge);
		await sleep(60);
		const before = notifications;
		page.disconnect();
		const reloaded = connectDemoPage(bridge);
		reloaded.snapshot(demoCommands().slice(0, 2));
		await sleep(250);
		expect(notifications).toBe(before + 1);
		expect(bridge.listCommands().length).toBe(2);
		bridge.dispose();
	});
});
