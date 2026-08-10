import { describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { createKernel } from "../src/kernel";
import type { PluginDefinition } from "../src/plugin";

// Kernel spec §4 — activation and lifecycle, plus the plugin diagnostics
// surface (diagnostics spec §6.2) that setup receives in this slice.

function harness(plugins: PluginDefinition[], options: { dev?: boolean } = {}) {
	const kernel = createKernel({
		plugins,
		dev: options.dev,
		diagnostics: { console: false },
	});
	const seen: Diagnostic[] = [];
	kernel.diagnostics.subscribe((d) => push(d));
	function push(d: Diagnostic) {
		seen.push(d);
	}
	return { kernel, seen };
}

const base = { name: "Test Plugin", version: "1.0.0" };

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("kernel §4.1 activation hints", () => {
	it("eager is the default when the field is omitted — the plugin activates", async () => {
		const setup = vi.fn();
		const { kernel } = harness([{ id: "acme.a", ...base, setup }]);
		await kernel.ready;
		expect(setup).toHaveBeenCalledTimes(1);
	});

	it("an explicit eager hint activates", async () => {
		const setup = vi.fn();
		const { kernel } = harness([
			{ id: "acme.a", ...base, activation: ["eager"], setup },
		]);
		await kernel.ready;
		expect(setup).toHaveBeenCalledTimes(1);
	});

	it("MUST behaviorally ignore unknown hints with a dev-mode warning — the plugin still activates (v1 has no lazy machinery)", async () => {
		const setup = vi.fn();
		const { kernel, seen } = harness([
			{ id: "acme.a", ...base, activation: ["on-command"], setup },
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "unknown-activation-hint",
				plugin: "acme.a",
				subject: "on-command",
			}),
		);
		expect(setup).toHaveBeenCalledTimes(1);
	});
});

describe("kernel §4.2 activation", () => {
	it("MUST NOT reorder plugins — activation order is the array order, even across async setups", async () => {
		const order: string[] = [];
		const { kernel } = harness([
			{
				id: "acme.slow",
				...base,
				setup: async () => {
					order.push("slow:start");
					await tick();
					order.push("slow:end");
				},
			},
			{
				id: "acme.fast",
				...base,
				setup: () => {
					order.push("fast");
				},
			},
		]);
		await kernel.ready;
		// the kernel awaits each setup before the next: fast runs after slow settles
		expect(order).toEqual(["slow:start", "slow:end", "fast"]);
	});

	it("setup MAY be async; the kernel always awaits it (ready settles after)", async () => {
		let done = false;
		const { kernel } = harness([
			{
				id: "acme.a",
				...base,
				setup: async () => {
					await tick();
					done = true;
				},
			},
		]);
		await kernel.ready;
		expect(done).toBe(true);
	});

	it("a throwing setup blocks THAT plugin only — loud setup-failed, later plugins proceed", async () => {
		const later = vi.fn();
		const { kernel, seen } = harness([
			{
				id: "acme.bad",
				...base,
				setup: () => {
					throw new Error("boom");
				},
			},
			{ id: "acme.good", ...base, setup: later },
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "setup-failed",
				plugin: "acme.bad",
			}),
		);
		expect(later).toHaveBeenCalledTimes(1);
	});

	it("a rejecting async setup is the same loud setup-failed", async () => {
		const { kernel, seen } = harness([
			{
				id: "acme.bad",
				...base,
				setup: async () => Promise.reject(new Error("boom")),
			},
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "setup-failed", plugin: "acme.bad" }),
		);
	});

	it("ready settles even when every plugin fails (§18.2: it never rejects)", async () => {
		const { kernel } = harness([
			{
				id: "acme.bad",
				...base,
				setup: () => {
					throw new Error("boom");
				},
			},
		]);
		await expect(kernel.ready).resolves.toBeUndefined();
	});
});

describe("kernel §4.3 teardown: Disposable", () => {
	it("api.onDispose registers teardown that runs on plugin deactivation", async () => {
		const cleanup = vi.fn();
		const { kernel } = harness([
			{ id: "acme.a", ...base, setup: (api) => api.onDispose(cleanup) },
		]);
		await kernel.ready;
		expect(cleanup).not.toHaveBeenCalled();
		kernel.dispose();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("the kernel disposes everything it tracked for every plugin", async () => {
		const calls: string[] = [];
		const { kernel } = harness([
			{
				id: "acme.a",
				...base,
				setup: (api) => {
					api.onDispose(() => calls.push("a1"));
					api.onDispose(() => calls.push("a2"));
				},
			},
			{
				id: "acme.b",
				...base,
				setup: (api) => api.onDispose(() => calls.push("b")),
			},
		]);
		await kernel.ready;
		kernel.dispose();
		expect(calls.sort()).toEqual(["a1", "a2", "b"]);
	});

	it("a throwing teardown does not strand the rest", async () => {
		const survivor = vi.fn();
		const { kernel } = harness([
			{
				id: "acme.a",
				...base,
				setup: (api) =>
					api.onDispose(() => {
						throw new Error("bad cleanup");
					}),
			},
			{ id: "acme.b", ...base, setup: (api) => api.onDispose(survivor) },
		]);
		await kernel.ready;
		expect(() => kernel.dispose()).not.toThrow();
		expect(survivor).toHaveBeenCalledTimes(1);
	});
});

describe("diagnostics §6.2 the plugin surface: api.diagnostics", () => {
	it("emit stamps source with the calling plugin's id — a plugin cannot speak as anyone else (§4.1)", async () => {
		const { kernel, seen } = harness([
			{
				id: "acme.a",
				...base,
				setup: (api) => {
					// even a spoofed source field is overridden by the kernel's stamp
					api.diagnostics.emit({
						severity: "error",
						code: "invalid-contribution",
						source: "kernel",
						message: "malformed contribution",
					} as never);
				},
			},
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({
				code: "invalid-contribution",
				source: "acme.a",
			}),
		);
	});

	it("subscribe has full cross-plugin visibility", async () => {
		const received: Diagnostic[] = [];
		const { kernel } = harness([
			{
				id: "acme.listener",
				...base,
				setup: (api) => {
					api.diagnostics.subscribe((d) => received.push(d));
				},
			},
			{
				id: "acme.talker",
				...base,
				setup: (api) => {
					api.diagnostics.emit({
						severity: "warning",
						code: "invalid-badge-value",
						message: "x",
					});
				},
			},
		]);
		await kernel.ready;
		expect(received).toContainEqual(
			expect.objectContaining({
				code: "invalid-badge-value",
				source: "acme.talker",
			}),
		);
	});

	it("warning emissions via emit obey dev mode — dropped, not delivered, when dev is off", async () => {
		const { kernel, seen } = harness(
			[
				{
					id: "acme.a",
					...base,
					setup: (api) => {
						api.diagnostics.emit({
							severity: "warning",
							code: "manifest-drift",
							message: "x",
						});
					},
				},
			],
			{ dev: false },
		);
		await kernel.ready;
		expect(seen.filter((d) => d.code === "manifest-drift")).toEqual([]);
	});
});
