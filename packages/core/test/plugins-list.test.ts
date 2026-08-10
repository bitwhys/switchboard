import { describe, expect, it } from "vitest";
import { createKernel } from "../src/kernel";
import type { PluginApi, PluginRecord } from "../src/plugin";

// Kernel spec §16.2 — the plugin list: one record per installed plugin
// in installation order, the manifest verbatim minus `setup` plus the
// kernel-added `status`; a pull, not a feed. §16.3 — both doors.

const base = { name: "Test Plugin", version: "1.0.0" };

describe("kernel §16.2 the plugin list", () => {
	it("returns one record per installed plugin, synchronously, in installation order (§16.2)", async () => {
		const kernel = createKernel({
			plugins: [
				{ id: "acme.b", ...base, setup: () => {} },
				{ id: "acme.a", ...base, setup: () => {} },
			],
			diagnostics: { console: false },
		});
		await kernel.ready;
		expect(kernel.plugins.list().map((r) => r.id)).toEqual([
			"acme.b",
			"acme.a",
		]);
	});

	it("a rejected manifest never appears — the rejection was already loud (§16.2, §3.3)", async () => {
		const kernel = createKernel({
			plugins: [
				{ id: "not a name!", ...base, setup: () => {} },
				{ id: "acme.ok", ...base, setup: () => {} },
			],
			diagnostics: { console: false },
		});
		await kernel.ready;
		expect(kernel.plugins.list().map((r) => r.id)).toEqual(["acme.ok"]);
	});

	it("a record is the manifest minus `setup`, unknown fields preserved verbatim (§16.2)", async () => {
		const kernel = createKernel({
			plugins: [
				{
					id: "acme.a",
					...base,
					description: "d",
					permissions: ["storage:use"],
					provides: ["acme.cap@1.0.0"],
					experimental: { flag: true },
					setup: () => {},
				} as never,
			],
			diagnostics: { console: false },
		});
		await kernel.ready;
		const record = kernel.plugins.list()[0] as PluginRecord &
			Record<string, unknown>;
		expect(record).toMatchObject({
			id: "acme.a",
			name: "Test Plugin",
			version: "1.0.0",
			description: "d",
			permissions: ["storage:use"],
			provides: ["acme.cap@1.0.0"],
			experimental: { flag: true },
			status: "active",
		});
		expect(record.setup).toBeUndefined(); // MUST NOT be reachable
	});

	it("status: pending while an async setup runs, active once it completes (§16.2)", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let duringOwnSetup: string | undefined;
		let api!: PluginApi;
		const kernel = createKernel({
			plugins: [
				{
					id: "acme.slow",
					...base,
					setup: (a) => {
						api = a;
						duringOwnSetup = a.plugins.list()[0]?.status;
						return gate;
					},
				},
			],
			diagnostics: { console: false },
		});
		// not yet activated → pending; still pending while its setup runs
		await Promise.resolve();
		expect(duringOwnSetup).toBe("pending");
		release();
		await kernel.ready;
		expect(api.plugins.list()[0]?.status).toBe("active");
	});

	it("status: failed for a throwing setup and for a failed capability check (§16.2, §10.3)", async () => {
		const kernel = createKernel({
			plugins: [
				{
					id: "acme.throws",
					...base,
					setup: () => {
						throw new Error("boom");
					},
				},
				{
					id: "acme.unmet",
					...base,
					requires: ["acme.missing"],
					setup: () => {},
				},
			],
			diagnostics: { console: false },
		});
		await kernel.ready;
		expect(kernel.plugins.list().map((r) => [r.id, r.status])).toEqual([
			["acme.throws", "failed"],
			["acme.unmet", "failed"],
		]);
	});

	it("each call returns a fresh snapshot (§16.2)", async () => {
		const kernel = createKernel({
			plugins: [{ id: "acme.a", ...base, setup: () => {} }],
			diagnostics: { console: false },
		});
		await kernel.ready;
		const first = kernel.plugins.list();
		const second = kernel.plugins.list();
		expect(first).not.toBe(second);
		expect(first[0]).not.toBe(second[0]);
		expect(first).toEqual(second);
	});

	it("both doors expose the same list under the same name (§16.3)", async () => {
		let api!: PluginApi;
		const kernel = createKernel({
			plugins: [
				{
					id: "acme.a",
					...base,
					setup: (a) => {
						api = a;
					},
				},
			],
			diagnostics: { console: false },
		});
		await kernel.ready;
		expect(api.plugins.list()).toEqual(kernel.plugins.list());
	});
});
