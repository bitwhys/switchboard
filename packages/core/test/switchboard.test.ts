import { afterEach, describe, expect, it, vi } from "vitest";
import { SwitchboardError } from "../src/errors";
import type { KernelHandoff } from "../src/handoff";
import type { PluginApi } from "../src/plugin";
import { createSwitchboard } from "../src/switchboard";

// Kernel spec §18 — `createSwitchboard`: synchronous construction whose
// `plugins` array is the activation order; the instance as a full host
// door with `host`-attributed acts; `ready` that settles always; the
// `invalid-options`-only throw envelope.

const base = { name: "Test Plugin", version: "1.0.0" };
const quiet = { diagnostics: { console: false } };

afterEach(() => {
	delete (globalThis as { __SWITCHBOARD__?: KernelHandoff }).__SWITCHBOARD__;
});

describe("kernel §18.1 signature", () => {
	it("returns the instance synchronously; activation proceeds unawaited (§18.1)", async () => {
		let activated = false;
		const kernel = createSwitchboard({
			plugins: [
				{
					id: "acme.a",
					...base,
					setup: () => {
						activated = true;
					},
				},
			],
			...quiet,
		});
		expect(kernel.ready).toBeInstanceOf(Promise); // an instance, not a promise
		expect(activated).toBe(false); // not awaited by the caller
		await kernel.ready;
		expect(activated).toBe(true);
		kernel.dispose();
	});

	it("the plugins array is the activation order, verbatim (§18.1, §4.2)", async () => {
		const order: string[] = [];
		const plugin = (id: string) => ({
			id,
			...base,
			setup: () => {
				order.push(id);
			},
		});
		const kernel = createSwitchboard({
			plugins: [plugin("acme.b"), plugin("acme.a"), plugin("acme.c")],
			...quiet,
		});
		await kernel.ready;
		expect(order).toEqual(["acme.b", "acme.a", "acme.c"]);
		kernel.dispose();
	});
});

describe("kernel §18.2 the instance", () => {
	it("is a full host door: four primitives, plugins, diagnostics, ready, dispose (§18.2)", async () => {
		const kernel = createSwitchboard({ plugins: [], ...quiet });
		expect(kernel.commands).toBeDefined();
		expect(kernel.events).toBeDefined();
		expect(kernel.context).toBeDefined();
		expect(kernel.services).toBeDefined();
		expect(typeof kernel.plugins.list).toBe("function");
		expect(typeof kernel.diagnostics.subscribe).toBe("function");
		expect(typeof kernel.dispose).toBe("function");
		await kernel.ready;
		kernel.dispose();
	});

	it("acts through the instance are attributed to the reserved `host` party (§18.2)", async () => {
		let api!: PluginApi;
		const kernel = createSwitchboard({
			plugins: [
				{
					id: "acme.a",
					...base,
					setup: (a) => {
						api = a;
					},
				},
			],
			...quiet,
		});
		await kernel.ready;

		// EmitMeta.source (§7)
		const onEvent = vi.fn();
		api.events.on("acme.happened", onEvent);
		kernel.events.emit("acme.happened");
		expect(onEvent).toHaveBeenCalledWith(
			undefined,
			expect.objectContaining({ source: "host" }),
		);

		// EmitMeta.source (§8)
		const onContext = vi.fn();
		kernel.context.set("acme.state", 1);
		api.context.observe("acme.state", onContext);
		expect(onContext).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ source: "host" }),
		);

		// Invocation.source (§6)
		let source: string | undefined;
		api.commands.register({
			id: "acme.cmd",
			title: "t",
			execute: (_input, invocation) => {
				source = invocation.source;
			},
		});
		await kernel.commands.execute("acme.cmd");
		expect(source).toBe("host");

		// registry attribution (§16.1)
		kernel.commands.register({ id: "acme.host", title: "t", execute: () => 0 });
		const records = kernel.plugins.list(); // plugin door parity checked in §16 tests
		expect(records.map((r) => r.id)).toEqual(["acme.a"]);
		let commandOwners: string[] = [];
		kernel.commands.observe((r) => {
			commandOwners = r.map((c) => c.pluginId);
		});
		expect(commandOwners).toEqual(["acme.a", "host"]);

		kernel.dispose();
	});

	it("`ready` settles always and never rejects — per-plugin failures stay contained (§18.2)", async () => {
		const kernel = createSwitchboard({
			plugins: [
				{
					id: "acme.bad",
					...base,
					setup: () => {
						throw new Error("boom");
					},
				},
			],
			...quiet,
		});
		await expect(kernel.ready).resolves.toBeUndefined();
		expect(kernel.plugins.list()[0]?.status).toBe("failed");
		kernel.dispose();
	});

	it("dispose tears down plugins and reclaims host-door registrations (§18.2, §4.3)", async () => {
		const kernel = createSwitchboard({ plugins: [], ...quiet });
		await kernel.ready;
		const onEvent = vi.fn();
		kernel.events.on("acme.happened", onEvent);
		kernel.dispose();
		kernel.events.emit("acme.happened");
		expect(onEvent).not.toHaveBeenCalled();
	});
});

describe("kernel §18.3 failure envelope", () => {
	it("throws `invalid-options` synchronously on a missing or non-array plugins (§18.3)", () => {
		for (const options of [
			{},
			{ plugins: "nope" },
			{ plugins: null },
		] as never[]) {
			try {
				createSwitchboard(options);
				expect.unreachable("should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(SwitchboardError);
				expect((error as SwitchboardError).code).toBe("invalid-options");
			}
		}
	});

	it("throws `invalid-options` on a storage value that is not a storage engine (§18.3)", () => {
		expect(() =>
			createSwitchboard({ plugins: [], storage: {} as never, ...quiet }),
		).toThrowError(
			expect.objectContaining({ code: "invalid-options" }) as never,
		);
	});

	it("everything past the boundary is contained per-plugin, never a construction throw (§18.3)", async () => {
		const kernel = createSwitchboard({
			plugins: [
				{ id: "not a name!", ...base, setup: () => {} }, // manifest rejection (§3.3)
				{ id: "acme.dup", ...base, setup: () => {} },
				{ id: "acme.dup", ...base, setup: () => {} }, // duplicate id (§2.2)
				{
					id: "acme.bad",
					...base,
					setup: () => {
						throw new Error("boom");
					},
				}, // throwing setup (§4.2)
			],
			...quiet,
		});
		await expect(kernel.ready).resolves.toBeUndefined();
		kernel.dispose();
	});
});
