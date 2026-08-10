import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { createKernel, type SwitchboardOptions } from "../src/kernel";
import type { PluginDefinition } from "../src/plugin";

// Kernel spec §10 — Capabilities: checked, not solved. Single provider
// (§10.2), the once-per-plugin activation check before setup (§10.3),
// and the manifest-drift warning (§10.4).

const base = { name: "Test Plugin", version: "1.0.0" };

async function harness(
	plugins: PluginDefinition[],
	options?: Partial<SwitchboardOptions>,
) {
	const kernel = createKernel({
		plugins,
		diagnostics: { console: false },
		...options,
	});
	const seen: Diagnostic[] = [];
	kernel.diagnostics.subscribe((d) => seen.push(d));
	await kernel.ready;
	return { seen, kernel };
}

const diag = (code: string, rest: Record<string, unknown> = {}) =>
	expect.objectContaining({ code, ...rest });

describe("kernel §10.1 requires range grammar (validated at §3.3)", () => {
	it("rejects a requires entry whose range is not a valid semver range — invalid-manifest, that plugin only", async () => {
		let ran = false;
		const { seen } = await harness([
			{
				id: "acme.bad-range",
				...base,
				requires: ["markdown.renderer@not a range"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(false);
		expect(seen).toContainEqual(
			diag("invalid-manifest", { severity: "error" }),
		);
	});

	it("accepts real range syntax: caret, comparator pairs, x-ranges, unions", async () => {
		const ranges = ["cap@^1", "cap@>=2.0.0 <3", "cap@1.x || 2.x", "cap@~1.2"];
		for (const entry of ranges) {
			let ran = false;
			await harness([
				{ id: "acme.p", ...base, provides: ["cap@1.2.3"], setup: () => {} },
				{
					id: "acme.r",
					...base,
					requires: [entry],
					setup: () => {
						ran = true;
					},
				},
			]);
			// grammar acceptance is the point here; ^1/~1.2/1.x||2.x are also
			// satisfied by 1.2.3, >=2 <3 is not — the check outcome is §10.3's
			// tests. Either way the manifest must not be rejected as malformed.
			expect(ran, entry).toBe(entry !== "cap@>=2.0.0 <3");
		}
	});
});

describe("kernel §10.2 single provider", () => {
	it("MUST block a second installed plugin providing an already-provided name — duplicate-provider, first wins", async () => {
		let first = false;
		let second = false;
		const { seen } = await harness([
			{
				id: "acme.first",
				...base,
				provides: ["markdown.renderer@1.0.0"],
				setup: () => {
					first = true;
				},
			},
			{
				id: "acme.second",
				...base,
				provides: ["markdown.renderer@2.0.0"],
				setup: () => {
					second = true;
				},
			},
		]);
		expect(first).toBe(true);
		expect(second).toBe(false);
		const entry = seen.find((d) => d.code === "duplicate-provider");
		expect(entry).toEqual(
			diag("duplicate-provider", {
				severity: "error",
				plugin: "acme.second",
				subject: "markdown.renderer",
			}),
		);
		// the diagnostic names the plugin already holding the capability
		expect(entry?.message).toContain("acme.first");
	});

	it("a duplicate within one manifest is also a duplicate-provider error", async () => {
		let ran = false;
		const { seen } = await harness([
			{
				id: "acme.selfdup",
				...base,
				provides: ["cap", "cap@1.0.0"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(false);
		expect(seen).toContainEqual(
			diag("duplicate-provider", { plugin: "acme.selfdup", subject: "cap" }),
		);
	});

	it("a blocked plugin's other provides count for nothing — requirers of them fail the §10.3 check", async () => {
		let ran = false;
		const { seen } = await harness([
			{ id: "acme.first", ...base, provides: ["cap"], setup: () => {} },
			{
				id: "acme.blocked",
				...base,
				provides: ["cap", "other.cap"],
				setup: () => {},
			},
			{
				id: "acme.requirer",
				...base,
				requires: ["other.cap"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(false);
		expect(seen).toContainEqual(
			diag("capability-unsatisfied", { plugin: "acme.requirer" }),
		);
	});
});

describe("kernel §10.3 the check", () => {
	it("a satisfied bare requires activates — any version suffices", async () => {
		let ran = false;
		await harness([
			{ id: "acme.p", ...base, provides: ["cap@0.1.0"], setup: () => {} },
			{
				id: "acme.r",
				...base,
				requires: ["cap"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(true);
	});

	it("a satisfied range activates: satisfies(version, range) holds", async () => {
		let ran = false;
		await harness([
			{ id: "acme.p", ...base, provides: ["cap@2.1.0"], setup: () => {} },
			{
				id: "acme.r",
				...base,
				requires: ["cap@^2"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(true);
	});

	it("the check runs against installed plugins, not activated ones — a requirer earlier in the array than its provider passes", async () => {
		let ran = false;
		await harness([
			{
				id: "acme.r",
				...base,
				requires: ["cap@^1"],
				setup: () => {
					ran = true;
				},
			},
			{ id: "acme.p", ...base, provides: ["cap@1.0.0"], setup: () => {} },
		]);
		expect(ran).toBe(true);
	});

	it("MUST block the plugin before its setup when no provider is installed, naming the requiring plugin and the required string", async () => {
		let ran = false;
		const { seen } = await harness([
			{
				id: "acme.docs-panel",
				...base,
				requires: ["markdown.renderer@^1"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(false);
		const entry = seen.find((d) => d.code === "capability-unsatisfied");
		expect(entry).toEqual(
			diag("capability-unsatisfied", {
				severity: "error",
				plugin: "acme.docs-panel",
				subject: "markdown.renderer@^1",
			}),
		);
		expect(entry?.message).toContain("no provider");
	});

	it("MUST name every near-miss with versions when the range is not satisfied", async () => {
		let ran = false;
		const { seen } = await harness([
			{
				id: "acme.provider",
				...base,
				provides: ["markdown.renderer@2.0.0"],
				setup: () => {},
			},
			{
				id: "acme.docs-panel",
				...base,
				requires: ["markdown.renderer@^1"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(false);
		const entry = seen.find((d) => d.code === "capability-unsatisfied");
		expect(entry?.plugin).toBe("acme.docs-panel");
		expect(entry?.subject).toBe("markdown.renderer@^1");
		// the near-miss: provider id and its declared version, per §10.3's example
		expect(entry?.message).toContain("acme.provider");
		expect(entry?.message).toContain("2.0.0");
	});

	it("a version-less provider does not satisfy a ranged requires — there is no version for satisfies() to check", async () => {
		let ran = false;
		const { seen } = await harness([
			{ id: "acme.p", ...base, provides: ["cap"], setup: () => {} },
			{
				id: "acme.r",
				...base,
				requires: ["cap@^1"],
				setup: () => {
					ran = true;
				},
			},
		]);
		expect(ran).toBe(false);
		const entry = seen.find((d) => d.code === "capability-unsatisfied");
		expect(entry?.message).toContain("no version");
	});

	it("failure blocks that plugin only — siblings before and after still activate", async () => {
		const ran: string[] = [];
		await harness([
			{
				id: "acme.before",
				...base,
				setup: () => {
					ran.push("before");
				},
			},
			{
				id: "acme.blocked",
				...base,
				requires: ["nobody.provides"],
				setup: () => {
					ran.push("blocked");
				},
			},
			{
				id: "acme.after",
				...base,
				setup: () => {
					ran.push("after");
				},
			},
		]);
		expect(ran).toEqual(["before", "after"]);
	});

	it("emits one diagnostic per unsatisfied requires entry", async () => {
		const { seen } = await harness([
			{
				id: "acme.r",
				...base,
				requires: ["missing.one", "missing.two"],
				setup: () => {},
			},
		]);
		const entries = seen.filter((d) => d.code === "capability-unsatisfied");
		expect(entries.map((d) => d.subject)).toEqual([
			"missing.one",
			"missing.two",
		]);
	});

	it("pending service gets on a check-blocked provider reject with the capability failure — get never hangs", async () => {
		let rejection: unknown;
		await harness([
			{
				id: "acme.consumer",
				...base,
				setup: (api) => {
					api.services.get("blocked.svc").catch((e: unknown) => {
						rejection = e;
					});
				},
			},
			{
				id: "acme.blocked-provider",
				...base,
				provides: ["blocked.svc"],
				requires: ["nobody.provides"],
				setup: (api) => {
					api.services.register("blocked.svc", {});
				},
			},
		]);
		await Promise.resolve();
		expect(rejection).toEqual(
			expect.objectContaining({
				name: "SwitchboardError",
				code: "capability-unsatisfied",
			}),
		);
	});

	it("no runtime re-check: disposing the provider's service after activation raises no new capability diagnostics", async () => {
		const { seen } = await harness([
			{
				id: "acme.p",
				...base,
				provides: ["cap@1.0.0"],
				setup: (api) => {
					const d = api.services.register("cap", {});
					d.dispose();
				},
			},
			{ id: "acme.r", ...base, requires: ["cap@^1"], setup: () => {} },
		]);
		expect(seen.filter((d) => d.code === "capability-unsatisfied")).toEqual([]);
	});
});

describe("kernel §10.4 manifest-drift warning", () => {
	it("SHOULD warn when a registered service name appears in no plugin's provides", async () => {
		const { seen } = await harness([
			{
				id: "acme.p",
				...base,
				setup: (api) => {
					api.services.register("undeclared.svc", {});
				},
			},
		]);
		expect(seen).toContainEqual(
			diag("manifest-drift", {
				severity: "warning",
				plugin: "acme.p",
				subject: "undeclared.svc",
			}),
		);
	});

	it("does not warn when the name is declared in some plugin's provides", async () => {
		const { seen } = await harness([
			{
				id: "acme.p",
				...base,
				provides: ["declared.svc@1.0.0"],
				setup: (api) => {
					api.services.register("declared.svc", {});
				},
			},
		]);
		expect(seen.filter((d) => d.code === "manifest-drift")).toEqual([]);
	});

	it("is a dev-mode warning: dropped entirely when dev is off", async () => {
		const { seen } = await harness(
			[
				{
					id: "acme.p",
					...base,
					setup: (api) => {
						api.services.register("undeclared.svc", {});
					},
				},
			],
			{ dev: false },
		);
		expect(seen.filter((d) => d.code === "manifest-drift")).toEqual([]);
	});
});
