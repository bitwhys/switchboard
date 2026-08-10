import { describe, expect, it, vi } from "vitest";
import type { CommandRecord } from "../src/commands";
import { createKernel } from "../src/kernel";
import type { PluginApi } from "../src/plugin";

// Kernel spec §16.1 — observing commands: full-array snapshots with
// synchronous replay on subscribe; fires on registration, disposal, and
// `when` flips, and on nothing else; records carry data fields only.
// §16.3 — the same surface on both doors, grant-agnostic.

const base = { name: "Test Plugin", version: "1.0.0" };

async function withApi(): Promise<{
	api: PluginApi;
	kernel: ReturnType<typeof createKernel>;
}> {
	let captured: PluginApi | undefined;
	const kernel = createKernel({
		plugins: [
			{
				id: "acme.a",
				...base,
				// no permissions: §16 is grant-agnostic (§16.3)
				setup: (api) => {
					captured = api;
				},
			},
		],
		diagnostics: { console: false },
	});
	await kernel.ready;
	if (!captured) throw new Error("setup did not run");
	return { api: captured, kernel };
}

describe("kernel §16.1 observing commands", () => {
	it("fires synchronously on subscribe with the complete current array (§16.1)", async () => {
		const { api } = await withApi();
		api.commands.register({ id: "acme.one", title: "t", execute: () => 0 });
		const cb = vi.fn();
		api.commands.observe(cb);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0][0]).toEqual([
			expect.objectContaining({ id: "acme.one", pluginId: "acme.a" }),
		]);
	});

	it("fires the complete new array on registration and disposal, in registration order (§16.1)", async () => {
		const { api } = await withApi();
		const cb = vi.fn();
		api.commands.observe(cb);
		api.commands.register({ id: "acme.one", title: "1", execute: () => 0 });
		const two = api.commands.register({
			id: "acme.two",
			title: "2",
			execute: () => 0,
		});
		expect(cb).toHaveBeenCalledTimes(3); // replay + two registrations
		expect((cb.mock.calls[2][0] as CommandRecord[]).map((r) => r.id)).toEqual([
			"acme.one",
			"acme.two",
		]);
		two.dispose();
		expect(cb).toHaveBeenCalledTimes(4);
		expect((cb.mock.calls[3][0] as CommandRecord[]).map((r) => r.id)).toEqual([
			"acme.one",
		]);
	});

	it("fires on a `when` flip and on nothing else (§16.1, §11.1)", async () => {
		const { api } = await withApi();
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			when: (ctx) => ctx.get("acme.mode") === "on",
			execute: () => 0,
		});
		const cb = vi.fn();
		api.commands.observe(cb);
		expect(cb).toHaveBeenCalledTimes(1); // replay
		api.context.set("acme.mode", "off"); // re-evaluates, no flip
		expect(cb).toHaveBeenCalledTimes(1);
		api.context.set("acme.mode", "on"); // flip: false → true
		expect(cb).toHaveBeenCalledTimes(2);
		expect((cb.mock.calls[1][0] as CommandRecord[])[0].listed).toBe(true);
		api.events.emit("acme.noise"); // events never fire the feed
		expect(cb).toHaveBeenCalledTimes(2);
	});

	it("when-hidden commands are included, with listed: false (§16.1)", async () => {
		const { api } = await withApi();
		api.commands.register({
			id: "acme.hidden",
			title: "t",
			when: () => false,
			execute: () => 0,
		});
		const cb = vi.fn();
		api.commands.observe(cb);
		expect(cb.mock.calls[0][0]).toEqual([
			expect.objectContaining({ id: "acme.hidden", listed: false }),
		]);
	});

	it("records carry data fields only — schemas verbatim, behavior never crosses (§16.1)", async () => {
		const { api } = await withApi();
		const inputSchema = { type: "object" };
		const annotations = { readOnlyHint: true };
		api.commands.register({
			id: "acme.cmd",
			title: "Do",
			description: "d",
			inputSchema,
			annotations,
			validate: (input) => ({ value: input }),
			when: () => true,
			execute: () => 0,
		});
		let records: CommandRecord[] = [];
		api.commands.observe((r) => {
			records = r;
		});
		const record = records[0] as CommandRecord & Record<string, unknown>;
		expect(record.inputSchema).toBe(inputSchema); // carried verbatim (§6.2)
		expect(record.annotations).toBe(annotations); // carried verbatim (§6.4)
		expect(record.execute).toBeUndefined();
		expect(record.validate).toBeUndefined();
		expect(record.when).toBeUndefined();
	});

	it("both doors expose the same feed under the same name (§16.3)", async () => {
		const { api, kernel } = await withApi();
		api.commands.register({ id: "acme.cmd", title: "t", execute: () => 0 });
		const viaPlugin = vi.fn();
		const viaInstance = vi.fn();
		api.commands.observe(viaPlugin);
		kernel.commands.observe(viaInstance);
		expect(viaInstance.mock.calls[0][0]).toEqual(viaPlugin.mock.calls[0][0]);
	});
});
