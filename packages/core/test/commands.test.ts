import { describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import type { SwitchboardError } from "../src/errors";
import { createKernel } from "../src/kernel";
import type { PluginApi } from "../src/plugin";

// Kernel spec §6 — Commands: registration and dispatch, pre-dispatch
// validation, and the structured invocation errors. Conformance matches
// on diagnostic `code`, never message prose (diagnostics spec §3).

const base = { name: "Test Plugin", version: "1.0.0" };

async function harness(setup?: (api: PluginApi) => void | Promise<void>) {
	let captured: PluginApi | undefined;
	const kernel = createKernel({
		plugins: [
			{
				id: "acme.a",
				...base,
				setup: async (api) => {
					captured = api;
					await setup?.(api);
				},
			},
		],
		diagnostics: { console: false },
	});
	const seen: Diagnostic[] = [];
	kernel.diagnostics.subscribe((d) => seen.push(d));
	await kernel.ready;
	if (!captured) throw new Error("setup did not run");
	return { api: captured, seen, kernel };
}

const swErr = (code: string) =>
	expect.objectContaining({ name: "SwitchboardError", code });

describe("kernel §6.1 registration and dispatch", () => {
	it("register + execute: one structured input in, the handler's value out, always a Promise", async () => {
		const { api } = await harness();
		api.commands.register({
			id: "acme.add",
			title: "Add",
			execute: (input) =>
				(input as { a: number; b: number }).a +
				(input as { a: number; b: number }).b,
		});
		const result = api.commands.execute("acme.add", { a: 2, b: 3 });
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBe(5);
	});

	it("the handler MAY be async; callers still receive its value", async () => {
		const { api } = await harness();
		api.commands.register({
			id: "acme.later",
			title: "Later",
			execute: async () => "done",
		});
		await expect(api.commands.execute("acme.later")).resolves.toBe("done");
	});

	it("an omitted input arrives at the handler as an empty object", async () => {
		const { api } = await harness();
		const execute = vi.fn((_input: object) => 0);
		api.commands.register({ id: "acme.noop", title: "Noop", execute });
		await api.commands.execute("acme.noop");
		expect(execute.mock.calls[0]?.[0]).toEqual({});
	});

	it("MUST reject a command id violating the name grammar with a loud invalid-name error — thrown AND emitted (§2.1)", async () => {
		const { api, seen } = await harness();
		expect(() =>
			api.commands.register({ id: "Bad Id!", title: "t", execute: () => 0 }),
		).toThrow(swErr("invalid-name"));
		expect(seen).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "invalid-name",
				plugin: "acme.a",
				subject: "Bad Id!",
			}),
		);
	});

	it("MUST reject a plugin registration under switchboard.* loudly (§2.4)", async () => {
		const { api, seen } = await harness();
		expect(() =>
			api.commands.register({
				id: "switchboard.sneak",
				title: "t",
				execute: () => 0,
			}),
		).toThrow(swErr("reserved-namespace"));
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "reserved-namespace", plugin: "acme.a" }),
		);
	});

	it("command ids MUST be unique — a taken name is a loud name-taken error (§2.2)", async () => {
		const { api, seen } = await harness();
		api.commands.register({ id: "acme.cmd", title: "t", execute: () => 1 });
		expect(() =>
			api.commands.register({ id: "acme.cmd", title: "t", execute: () => 2 }),
		).toThrow(swErr("name-taken"));
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "name-taken", subject: "acme.cmd" }),
		);
		// the first registration is untouched
		await expect(api.commands.execute("acme.cmd")).resolves.toBe(1);
	});

	it("disposal frees the id: execute rejects command-not-found, and re-registration succeeds (§4.3)", async () => {
		const { api } = await harness();
		const d = api.commands.register({
			id: "acme.cmd",
			title: "t",
			execute: () => 1,
		});
		d.dispose();
		await expect(api.commands.execute("acme.cmd")).rejects.toEqual(
			swErr("command-not-found"),
		);
		api.commands.register({ id: "acme.cmd", title: "t", execute: () => 2 });
		await expect(api.commands.execute("acme.cmd")).resolves.toBe(2);
	});

	it("executing an unregistered id rejects loudly with command-not-found", async () => {
		const { api, seen } = await harness();
		await expect(api.commands.execute("acme.ghost")).rejects.toEqual(
			swErr("command-not-found"),
		);
		expect(seen).toContainEqual(
			expect.objectContaining({
				code: "command-not-found",
				subject: "acme.ghost",
			}),
		);
	});

	it("handler errors become structured invocation errors wrapped with the command id — loud command-failed, cause preserved", async () => {
		const { api, seen } = await harness();
		const boom = new Error("boom");
		api.commands.register({
			id: "acme.fails",
			title: "t",
			execute: () => {
				throw boom;
			},
		});
		const rejection = await api.commands.execute("acme.fails").then(
			() => null,
			(e: unknown) => e as SwitchboardError,
		);
		expect(rejection).toEqual(swErr("command-failed"));
		expect(rejection?.subject).toBe("acme.fails");
		expect(rejection?.cause).toBe(boom);
		expect(seen).toContainEqual(
			expect.objectContaining({
				code: "command-failed",
				plugin: "acme.a",
				subject: "acme.fails",
			}),
		);
	});

	it("an async handler rejection is the same loud command-failed", async () => {
		const { api } = await harness();
		api.commands.register({
			id: "acme.fails",
			title: "t",
			execute: async () => Promise.reject(new Error("boom")),
		});
		await expect(api.commands.execute("acme.fails")).rejects.toEqual(
			swErr("command-failed"),
		);
	});

	it("invocations through the plugin door carry source 'plugin' and an AbortSignal", async () => {
		const { api } = await harness();
		let invocation: { source: string; signal: unknown } | undefined;
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			execute: (_input, inv) => {
				invocation = inv;
			},
		});
		await api.commands.execute("acme.cmd");
		expect(invocation?.source).toBe("plugin");
		expect(invocation?.signal).toBeInstanceOf(AbortSignal);
	});
});

describe("kernel §6.3 validation", () => {
	it("MUST NOT run execute when validate returns issues — the issues come back as a structured invalid-input error, loudly", async () => {
		const { api, seen } = await harness();
		const execute = vi.fn();
		api.commands.register({
			id: "acme.strict",
			title: "t",
			validate: () => ({ issues: [{ message: "a is required", path: ["a"] }] }),
			execute,
		});
		const rejection = await api.commands.execute("acme.strict", {}).then(
			() => null,
			(e: unknown) => e as SwitchboardError,
		);
		expect(rejection).toEqual(swErr("invalid-input"));
		expect(rejection?.issues).toEqual([
			{ message: "a is required", path: ["a"] },
		]);
		expect(execute).not.toHaveBeenCalled();
		expect(seen).toContainEqual(
			expect.objectContaining({
				code: "invalid-input",
				subject: "acme.strict",
			}),
		);
	});

	it("the handler receives validate's returned value (Standard Schema may transform)", async () => {
		const { api } = await harness();
		const execute = vi.fn((_input: object) => 0);
		api.commands.register({
			id: "acme.coerce",
			title: "t",
			validate: (input) => ({ value: { ...(input as object), coerced: true } }),
			execute,
		});
		await api.commands.execute("acme.coerce", { a: 1 });
		expect(execute.mock.calls[0]?.[0]).toEqual({ a: 1, coerced: true });
	});

	it("when validate is absent the kernel dispatches unvalidated", async () => {
		const { api } = await harness();
		const execute = vi.fn((_input: object) => 0);
		api.commands.register({ id: "acme.loose", title: "t", execute });
		await api.commands.execute("acme.loose", { anything: "goes" });
		expect(execute.mock.calls[0]?.[0]).toEqual({ anything: "goes" });
	});
});

describe("kernel §11.2 visibility gates listing, never dispatch", () => {
	it("a when-false command still executes via commands.execute", async () => {
		const { api } = await harness();
		api.commands.register({
			id: "acme.hidden",
			title: "t",
			when: () => false,
			execute: () => "still works",
		});
		await expect(api.commands.execute("acme.hidden")).resolves.toBe(
			"still works",
		);
	});
});
