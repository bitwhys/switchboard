import { describe, expect, it, vi } from "vitest";
import type { CommandRecord, ContextView } from "../src/commands";
import { createKernel } from "../src/kernel";
import type { PluginApi } from "../src/plugin";

// Kernel spec §11 — visibility predicates: a plain pure function over a
// tracked-read Context view. The kernel re-evaluates only when a key the
// last run actually read changes, re-tracking on every run; `when` gates
// listing, never dispatch (§11.2).

const base = { name: "Test Plugin", version: "1.0.0" };

async function withApi(): Promise<{ api: PluginApi; dispose: () => void }> {
	let captured: PluginApi | undefined;
	const kernel = createKernel({
		plugins: [
			{
				id: "acme.a",
				...base,
				setup: (api) => {
					captured = api;
				},
			},
		],
		diagnostics: { console: false },
	});
	await kernel.ready;
	if (!captured) throw new Error("setup did not run");
	return { api: captured, dispose: () => kernel.dispose() };
}

function listedOf(api: PluginApi, id: string): boolean | undefined {
	let records: CommandRecord[] = [];
	api.commands
		.observe((r) => {
			records = r;
		})
		.dispose();
	return records.find((r) => r.id === id)?.listed;
}

describe("kernel §11 visibility predicates", () => {
	it("the view's get returns the latest value synchronously, undefined if unset (§11.1)", async () => {
		const { api } = await withApi();
		const seen: unknown[] = [];
		api.context.set("acme.mode", "on");
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			when: (ctx) => {
				seen.push(ctx.get("acme.mode"), ctx.get("acme.unset"));
				return true;
			},
			execute: () => 0,
		});
		expect(seen).toEqual(["on", undefined]);
	});

	it("re-evaluates only when a key the last run actually read changes (§11.1)", async () => {
		const { api } = await withApi();
		const when = vi.fn((ctx: ContextView) => ctx.get("acme.mode") === "on");
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			when,
			execute: () => 0,
		});
		expect(when).toHaveBeenCalledTimes(1); // the registration-time run
		api.context.set("acme.unrelated", 1);
		expect(when).toHaveBeenCalledTimes(1); // unread key: no re-evaluation
		api.context.set("acme.mode", "on");
		expect(when).toHaveBeenCalledTimes(2);
		expect(listedOf(api, "acme.cmd")).toBe(true);
	});

	it("re-tracks dependencies on every run — a branch switch drops the old key (§11.1)", async () => {
		const { api } = await withApi();
		const when = vi.fn((ctx: ContextView) =>
			ctx.get("acme.which") === "b"
				? ctx.get("acme.b") === true
				: ctx.get("acme.a") === true,
		);
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			when,
			execute: () => 0,
		});
		api.context.set("acme.which", "b"); // now reads acme.which + acme.b
		const runs = when.mock.calls.length;
		api.context.set("acme.a", true); // no longer a dependency
		expect(when).toHaveBeenCalledTimes(runs);
		api.context.set("acme.b", true); // current dependency
		expect(when).toHaveBeenCalledTimes(runs + 1);
		expect(listedOf(api, "acme.cmd")).toBe(true);
	});

	it("a when-false command vanishes from listing but execute still works (§11.2)", async () => {
		const { api } = await withApi();
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			when: () => false,
			execute: () => "ran",
		});
		expect(listedOf(api, "acme.cmd")).toBe(false);
		await expect(api.commands.execute("acme.cmd")).resolves.toBe("ran");
	});

	it("a command without `when` is always listed (§11)", async () => {
		const { api } = await withApi();
		api.commands.register({ id: "acme.cmd", title: "t", execute: () => 0 });
		expect(listedOf(api, "acme.cmd")).toBe(true);
	});

	it("a throwing predicate is contained: not listed, dev-mode `when-failed` warning (§11.1)", async () => {
		const { api } = await withApi();
		const diagnostics = vi.fn();
		api.diagnostics.subscribe(diagnostics);
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			when: () => {
				throw new Error("impure");
			},
			execute: () => 0,
		});
		expect(listedOf(api, "acme.cmd")).toBe(false);
		expect(diagnostics).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "warning",
				code: "when-failed",
				subject: "acme.cmd",
			}),
		);
	});
});
