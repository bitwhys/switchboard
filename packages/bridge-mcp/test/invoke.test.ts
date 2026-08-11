import { describe, expect, it } from "vitest";
import { createBridge } from "../src/node/core";
import { connectDemoPage, sleep } from "./harness";

// Bridge spec §7 — the invocation lifecycle at the bridge core: timeout
// fires the cancel path (§7.4), cancellation is cooperative and late
// results are discarded (§7.3), and a mid-invoke disconnect fails
// immediately with the honest "outcome unknown" (§7.5).

describe("bridge §7 invocation lifecycle", () => {
	it("§7.1: input reaches the page handler and the value comes back", async () => {
		const bridge = createBridge({ diagnostics: () => {} });
		connectDemoPage(bridge);
		const outcome = await bridge.invoke("demo.echo", { message: "hey" });
		expect(outcome).toMatchObject({ ok: true, value: { echoed: "hey" } });
	});

	it("§7.1: an unknown command answers actionably, pointing at switchboard.status", async () => {
		const bridge = createBridge({ diagnostics: () => {} });
		connectDemoPage(bridge);
		const outcome = await bridge.invoke("demo.missing", {});
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toContain("switchboard.status");
	});

	it("§7.4: the timeout expires with an error naming the command and the limit, and sends cancel", async () => {
		const bridge = createBridge({ invokeTimeoutMs: 50, diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		const outcome = await bridge.invoke("demo.slow", {});
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.error).toContain("demo.slow");
			expect(outcome.error).toContain("50ms");
		}
		expect(page.received.some((m) => m.type === "cancel")).toBe(true);
	});

	it("§7.3: agent-side abort forwards a cancel and settles the invocation", async () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		const controller = new AbortController();
		const pending = bridge.invoke("demo.slow", {}, controller.signal);
		controller.abort();
		const outcome = await pending;
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toContain("cancelled by agent");
		expect(page.received.some((m) => m.type === "cancel")).toBe(true);
	});

	it("§7.3: after a cancel, a terminal result for that id is tolerated and discarded", async () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		const controller = new AbortController();
		const pending = bridge.invoke("demo.slow", {}, controller.signal);
		controller.abort();
		await pending;
		// demo.slow answers a late result once its signal fires — feeding it
		// back into the bridge must be a no-op, not a crash.
		await sleep(20);
		expect(page.received.filter((m) => m.type === "cancel").length).toBe(1);
	});

	it("§7.5: a disconnect mid-invoke fails immediately — never waits out the grace period", async () => {
		const bridge = createBridge({
			gracePeriodMs: 60_000,
			diagnostics: () => {},
		});
		const page = connectDemoPage(bridge);
		const started = Date.now();
		const pending = bridge.invoke("demo.slow", {});
		page.disconnect();
		const outcome = await pending;
		expect(Date.now() - started).toBeLessThan(1_000);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toContain("outcome unknown");
		bridge.dispose();
	});
});
