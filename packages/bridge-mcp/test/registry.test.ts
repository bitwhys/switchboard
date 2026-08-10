import { describe, expect, it } from "vitest";
import { createBridge } from "../src/node/core";
import { connectDemoPage, demoCommands, sleep } from "./harness";

// Bridge spec §6 — registry sync is full snapshots, diffed at the bridge:
// only real deltas reach the agent surface, one batched notification per
// debounced registry change, and an identical re-announce (the page-reload
// case) produces ZERO agent-visible change.

function rigWithListener() {
	const bridge = createBridge({ diagnostics: () => {} });
	let notifications = 0;
	bridge.addListener({ onRegistryChanged: () => notifications++ });
	return { bridge, count: () => notifications };
}

describe("bridge §6 registry sync", () => {
	it("§6.1/§6.3: a snapshot lands the complete surface in the canonical registry", () => {
		const { bridge } = rigWithListener();
		connectDemoPage(bridge);
		expect(bridge.listCommands().map((c) => c.id)).toEqual([
			"demo.echo",
			"demo.slow",
			"demo.throws",
			"demo.bad-output",
		]);
	});

	it("§6.3: a burst of snapshots yields ONE batched notification", async () => {
		const { bridge, count } = rigWithListener();
		const page = connectDemoPage(bridge);
		page.snapshot(demoCommands().slice(0, 1));
		page.snapshot(demoCommands().slice(0, 2));
		page.snapshot(demoCommands());
		await sleep(60);
		expect(count()).toBe(1);
	});

	it("§6.3: an identical snapshot — the reload case — produces zero agent-visible change", async () => {
		const { bridge, count } = rigWithListener();
		const page = connectDemoPage(bridge);
		await sleep(60);
		const before = count();
		page.snapshot(demoCommands()); // identical re-announce
		await sleep(60);
		expect(count()).toBe(before);
	});

	it("§6.1: a when-flip (a command leaving the snapshot) is an ordinary delta", async () => {
		const { bridge, count } = rigWithListener();
		const page = connectDemoPage(bridge);
		await sleep(60);
		const before = count();
		page.snapshot(demoCommands().filter((c) => c.id !== "demo.slow"));
		await sleep(60);
		expect(count()).toBe(before + 1);
		expect(bridge.listCommands().map((c) => c.id)).not.toContain("demo.slow");
	});

	it("§6.2: snapshot entries pass through verbatim — unknown fields preserved", () => {
		const bridge = createBridge({ diagnostics: () => {} });
		const page = connectDemoPage(bridge);
		const [cmd] = demoCommands();
		if (!cmd) throw new Error("no demo command");
		page.snapshot([{ ...cmd, futureField: "kept" } as typeof cmd]);
		expect(
			(bridge.listCommands()[0] as { futureField?: string }).futureField,
		).toBe("kept");
	});
});
