import { describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { createKernel } from "../src/kernel";
import type { PluginDefinition } from "../src/plugin";
import { definePlugin } from "../src/plugin";

// Kernel spec §3 — plugin definition and manifest validation, exercised
// through the kernel seam: install plugins, observe diagnostics and setup.

function harness(plugins: unknown[], options: { dev?: boolean } = {}) {
	const kernel = createKernel({
		plugins: plugins as PluginDefinition[],
		dev: options.dev,
		diagnostics: { console: false },
	});
	const seen: Diagnostic[] = [];
	kernel.diagnostics.subscribe((d) => seen.push(d));
	return { kernel, seen };
}

const base = { name: "Test Plugin", version: "1.0.0" };

describe("kernel §3.1 definePlugin", () => {
	it("returns the definition object unchanged — an authoring affordance, not a validator", () => {
		const def = { id: "acme.a", ...base, setup: () => {} };
		expect(definePlugin(def)).toBe(def);
	});
});

describe("kernel §3.3 manifest validation", () => {
	it.each(["id", "name", "version", "setup"] as const)(
		"MUST reject a manifest missing required field %s with a loud invalid-manifest",
		async (field) => {
			const def: Record<string, unknown> = {
				id: "acme.a",
				...base,
				setup: vi.fn(),
			};
			delete def[field];
			const { kernel, seen } = harness([def]);
			await kernel.ready;
			expect(seen).toContainEqual(
				expect.objectContaining({
					severity: "error",
					code: "invalid-manifest",
					source: "kernel",
				}),
			);
			if (field !== "setup") expect(def.setup).not.toHaveBeenCalled();
		},
	);

	it("MUST reject an id violating the name grammar (§2.1)", async () => {
		const setup = vi.fn();
		const { kernel, seen } = harness([{ id: "Acme.Panel", ...base, setup }]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "invalid-manifest" }),
		);
		expect(setup).not.toHaveBeenCalled();
	});

	it("tolerates a single-segment plugin id — §2.3 two segments is SHOULD, not MUST", async () => {
		const setup = vi.fn();
		const { kernel, seen } = harness([{ id: "acme", ...base, setup }]);
		await kernel.ready;
		expect(seen.filter((d) => d.severity === "error")).toEqual([]);
		expect(setup).toHaveBeenCalled();
	});

	it("MUST reject a non-semver version", async () => {
		const { kernel, seen } = harness([
			{ id: "acme.a", name: "A", version: "1.0", setup: vi.fn() },
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "invalid-manifest" }),
		);
	});

	it("MUST reject malformed permission strings (§12.1 grammar)", async () => {
		const { kernel, seen } = harness([
			{ id: "acme.a", ...base, permissions: ["storage.use"], setup: vi.fn() },
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "invalid-manifest" }),
		);
	});

	it("MUST reject malformed activation hints (§4.1 colon grammar)", async () => {
		const { kernel, seen } = harness([
			{ id: "acme.a", ...base, activation: ["Eager"], setup: vi.fn() },
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "invalid-manifest" }),
		);
	});

	it("MUST reject malformed provides/requires entries (§10.1 grammar)", async () => {
		const { kernel: k1, seen: s1 } = harness([
			{ id: "acme.a", ...base, provides: ["toolbar@^1"], setup: vi.fn() },
		]);
		await k1.ready;
		expect(s1).toContainEqual(
			expect.objectContaining({ code: "invalid-manifest" }),
		);

		const { kernel: k2, seen: s2 } = harness([
			{ id: "acme.b", ...base, requires: ["tool_bar"], setup: vi.fn() },
		]);
		await k2.ready;
		expect(s2).toContainEqual(
			expect.objectContaining({ code: "invalid-manifest" }),
		);
	});

	it("MUST reject a non-object plugin entry, containing it to that entry", async () => {
		const setup = vi.fn();
		const { kernel, seen } = harness([null, { id: "acme.ok", ...base, setup }]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "invalid-manifest" }),
		);
		expect(setup).toHaveBeenCalled();
	});

	it("a manifest error blocks THAT plugin only — other plugins proceed", async () => {
		const good = vi.fn();
		const { kernel } = harness([
			{ id: "bad id!", ...base, setup: vi.fn() },
			{ id: "acme.good", ...base, setup: good },
		]);
		await kernel.ready;
		expect(good).toHaveBeenCalled();
	});

	it("MUST tolerate unknown manifest fields with a dev-mode warning, never an error", async () => {
		const setup = vi.fn();
		const { kernel, seen } = harness([
			{ id: "acme.a", ...base, manifestVersion: 1, setup },
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "unknown-manifest-field",
				plugin: "acme.a",
			}),
		);
		expect(seen.filter((d) => d.severity === "error")).toEqual([]);
		expect(setup).toHaveBeenCalled();
	});

	it("stamps attribution: source is the kernel, plugin is the offender when identifiable (diagnostics §4.2)", async () => {
		const { kernel, seen } = harness([
			{ id: "acme.a", name: "A", version: "nope", setup: () => {} },
		]);
		await kernel.ready;
		const d = seen.find((d) => d.code === "invalid-manifest");
		expect(d).toMatchObject({ source: "kernel", plugin: "acme.a" });
	});
});

describe("kernel §2.4 the reserved namespace (+ diagnostics §4.1 reserved sources)", () => {
	it.each(["switchboard.devtools", "switchboard"])(
		"MUST reject plugin id %s under the reserved switchboard namespace",
		async (id) => {
			const setup = vi.fn();
			const { kernel, seen } = harness([{ id, ...base, setup }]);
			await kernel.ready;
			expect(seen).toContainEqual(
				expect.objectContaining({
					severity: "error",
					code: "reserved-namespace",
				}),
			);
			expect(setup).not.toHaveBeenCalled();
		},
	);

	it.each(["kernel", "bridge", "host"])(
		"MUST reject the reserved plugin id %s (diagnostics §4.1)",
		async (id) => {
			const setup = vi.fn();
			const { kernel, seen } = harness([{ id, ...base, setup }]);
			await kernel.ready;
			expect(seen).toContainEqual(
				expect.objectContaining({ code: "reserved-namespace" }),
			);
			expect(setup).not.toHaveBeenCalled();
		},
	);
});

describe("kernel §2.2 plugin ids are an exclusive name kind", () => {
	it("a duplicate plugin id is blocked loudly — first wins (§18.3)", async () => {
		const first = vi.fn();
		const second = vi.fn();
		const { kernel, seen } = harness([
			{ id: "acme.a", ...base, setup: first },
			{ id: "acme.a", ...base, setup: second },
		]);
		await kernel.ready;
		expect(first).toHaveBeenCalled();
		expect(second).not.toHaveBeenCalled();
		expect(seen).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "name-taken",
				plugin: "acme.a",
			}),
		);
	});
});

describe("kernel §12.2 unknown permissions", () => {
	it("MUST tolerate an unknown well-formed permission with a warning — it grants nothing, the plugin proceeds", async () => {
		const setup = vi.fn();
		const { kernel, seen } = harness([
			{ id: "acme.a", ...base, permissions: ["future:thing"], setup },
		]);
		await kernel.ready;
		expect(seen).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "unknown-permission",
				plugin: "acme.a",
				subject: "future:thing",
			}),
		);
		expect(seen.filter((d) => d.severity === "error")).toEqual([]);
		expect(setup).toHaveBeenCalled();
	});
});
