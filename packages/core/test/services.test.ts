import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { createKernel } from "../src/kernel";
import type { PluginApi, PluginDefinition } from "../src/plugin";

// Kernel spec §9 — Services: live in-page values, exclusive names,
// activation-order-insensitive `get` that never hangs on a name no
// installed plugin provides.

const base = { name: "Test Plugin", version: "1.0.0" };

async function harness(plugins: PluginDefinition[]) {
	const kernel = createKernel({ plugins, diagnostics: { console: false } });
	const seen: Diagnostic[] = [];
	kernel.diagnostics.subscribe((d) => seen.push(d));
	await kernel.ready;
	return { seen, kernel };
}

async function withApi() {
	let captured: PluginApi | undefined;
	const { seen, kernel } = await harness([
		{
			id: "acme.a",
			...base,
			provides: ["acme.svc"],
			setup: (api) => {
				captured = api;
			},
		},
	]);
	if (!captured) throw new Error("setup did not run");
	return { api: captured, seen, kernel };
}

const swErr = (code: string) =>
	expect.objectContaining({ name: "SwitchboardError", code });

describe("kernel §9 services", () => {
	it("register + tryGet: the live value comes back synchronously, never serialized", async () => {
		const { api } = await withApi();
		const service = { greet: (who: string) => `hi ${who}` };
		api.services.register("acme.svc", service);
		// the very same object — a Service is a live JS value
		expect(api.services.tryGet("acme.svc")).toBe(service);
	});

	it("get resolves immediately when the service is already registered", async () => {
		const { api } = await withApi();
		const service = { n: 1 };
		api.services.register("acme.svc", service);
		await expect(api.services.get("acme.svc")).resolves.toBe(service);
	});

	it("get resolves the moment the provider registers — activation-order-insensitive without a resolver", async () => {
		// the consumer is EARLIER in the array than the provider; it must not
		// block its setup on the promise (activation is sequential, §4.2) —
		// it attaches to it and the value arrives once the provider runs
		let resolved: unknown;
		await harness([
			{
				id: "acme.consumer",
				...base,
				setup: (api) => {
					api.services.get("acme.svc").then((s) => {
						resolved = s;
					});
				},
			},
			{
				id: "acme.provider",
				...base,
				provides: ["acme.svc"],
				setup: (api) => {
					api.services.register("acme.svc", { real: true });
				},
			},
		]);
		await Promise.resolve();
		expect(resolved).toEqual({ real: true });
	});

	it("MUST reject immediately, loudly, when no installed plugin provides the capability — get never hangs", async () => {
		const { api, seen } = await withApi();
		await expect(api.services.get("nobody.provides-this")).rejects.toEqual(
			swErr("service-unavailable"),
		);
		expect(seen).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "service-unavailable",
				plugin: "acme.a",
				subject: "nobody.provides-this",
			}),
		);
	});

	it("pending gets reject with the provider's own setup failure", async () => {
		const boom = new Error("provider exploded");
		let rejection: unknown;
		await harness([
			{
				id: "acme.consumer",
				...base,
				setup: (api) => {
					api.services.get("acme.svc").catch((e: unknown) => {
						rejection = e;
					});
				},
			},
			{
				id: "acme.provider",
				...base,
				provides: ["acme.svc"],
				setup: () => {
					throw boom;
				},
			},
		]);
		await Promise.resolve();
		expect(rejection).toBe(boom);
	});

	it("get after the provider has already failed rejects with that failure too", async () => {
		const boom = new Error("provider exploded");
		let rejection: unknown;
		await harness([
			{
				id: "acme.provider",
				...base,
				provides: ["acme.svc"],
				setup: () => {
					throw boom;
				},
			},
			{
				id: "acme.consumer",
				...base,
				setup: (api) => {
					api.services.get("acme.svc").catch((e: unknown) => {
						rejection = e;
					});
				},
			},
		]);
		await Promise.resolve();
		expect(rejection).toBe(boom);
	});

	it("service names are exclusive: duplicate registration is a loud named error (§2.2)", async () => {
		const { api, seen } = await withApi();
		api.services.register("acme.svc", { first: true });
		expect(() => api.services.register("acme.svc", { second: true })).toThrow(
			swErr("name-taken"),
		);
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "name-taken", subject: "acme.svc" }),
		);
		expect(api.services.tryGet("acme.svc")).toEqual({ first: true });
	});

	it("disposal unregisters, and the name becomes registrable again", async () => {
		const { api } = await withApi();
		const d = api.services.register("acme.svc", { v: 1 });
		d.dispose();
		expect(api.services.tryGet("acme.svc")).toBeUndefined();
		expect(() => api.services.register("acme.svc", { v: 2 })).not.toThrow();
	});

	it("tryGet is the soft door: undefined for anything unregistered, no requires entry needed", async () => {
		const { api } = await withApi();
		expect(api.services.tryGet("acme.optional")).toBeUndefined();
	});

	it("naming applies: invalid names are loud invalid-name errors, switchboard.* registration is reserved (§2.1, §2.4)", async () => {
		const { api } = await withApi();
		expect(() => api.services.register("Bad Name", {})).toThrow(
			swErr("invalid-name"),
		);
		expect(() => api.services.register("switchboard.sneak", {})).toThrow(
			swErr("reserved-namespace"),
		);
	});
});
