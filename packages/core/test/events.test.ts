import { describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { createKernel } from "../src/kernel";
import type { PluginApi } from "../src/plugin";

// Kernel spec §7 — Events: named, fire-and-forget, strictly ephemeral.

const base = { name: "Test Plugin", version: "1.0.0" };

async function harness() {
	const apis = new Map<string, PluginApi>();
	const kernel = createKernel({
		plugins: ["acme.a", "acme.b"].map((id) => ({
			id,
			...base,
			setup: (api: PluginApi) => {
				apis.set(id, api);
			},
		})),
		diagnostics: { console: false },
	});
	const seen: Diagnostic[] = [];
	kernel.diagnostics.subscribe((d) => seen.push(d));
	await kernel.ready;
	const a = apis.get("acme.a");
	const b = apis.get("acme.b");
	if (!a || !b) throw new Error("setup did not run");
	return { a, b, seen, kernel };
}

const swErr = (code: string) =>
	expect.objectContaining({ name: "SwitchboardError", code });

describe("kernel §7 events", () => {
	it("emit reaches subscribers with the payload and kernel-stamped meta (source = emitting plugin id)", async () => {
		const { a, b } = await harness();
		const cb = vi.fn();
		b.events.on("acme.happened", cb);
		a.events.emit("acme.happened", { n: 1 });
		expect(cb).toHaveBeenCalledTimes(1);
		const [payload, meta] = cb.mock.calls[0] ?? [];
		expect(payload).toEqual({ n: 1 });
		expect(meta).toEqual({ source: "acme.a", timestamp: expect.any(Number) });
	});

	it("events are STRICTLY ephemeral: no replay, no buffering — a late subscriber missed it", async () => {
		const { a, b } = await harness();
		a.events.emit("acme.happened", 1);
		const late = vi.fn();
		b.events.on("acme.happened", late);
		expect(late).not.toHaveBeenCalled();
	});

	it("event names are an open channel: many plugins subscribe, and emission on another's namespace is unrestricted (§2.2)", async () => {
		const { a, b } = await harness();
		const onA = vi.fn();
		const onB = vi.fn();
		a.events.on("acme.shared", onA);
		b.events.on("acme.shared", onB);
		// b emits under a namespace it does not own — ownership is by convention
		b.events.emit("acme.shared", "x");
		expect(onA).toHaveBeenCalledTimes(1);
		expect(onB).toHaveBeenCalledTimes(1);
	});

	it("disposing the subscription stops delivery (§4.3)", async () => {
		const { a } = await harness();
		const cb = vi.fn();
		const d = a.events.on("acme.happened", cb);
		d.dispose();
		a.events.emit("acme.happened", 1);
		expect(cb).not.toHaveBeenCalled();
	});

	it("MUST validate names with the one shared validator: invalid names are loud invalid-name errors on emit and on (§2.1)", async () => {
		const { a, seen } = await harness();
		expect(() => a.events.emit("Not Valid")).toThrow(swErr("invalid-name"));
		expect(() => a.events.on("Not Valid", () => {})).toThrow(
			swErr("invalid-name"),
		);
		expect(
			seen.filter((d) => d.code === "invalid-name").length,
		).toBeGreaterThanOrEqual(2);
	});

	it("there are no wildcard subscriptions in v1 — `*` is outside the grammar", async () => {
		const { a } = await harness();
		expect(() => a.events.on("acme.*", () => {})).toThrow(
			swErr("invalid-name"),
		);
	});

	it("a plugin MUST NOT emit under switchboard.* (§2.4) — but listening there stays legal", async () => {
		const { a, seen } = await harness();
		expect(() => a.events.emit("switchboard.fake")).toThrow(
			swErr("reserved-namespace"),
		);
		expect(seen).toContainEqual(
			expect.objectContaining({
				code: "reserved-namespace",
				plugin: "acme.a",
				subject: "switchboard.fake",
			}),
		);
		expect(() => a.events.on("switchboard.something", () => {})).not.toThrow();
	});

	it("a throwing listener does not break the emitter or its peers", async () => {
		const { a, b } = await harness();
		const survivor = vi.fn();
		a.events.on("acme.happened", () => {
			throw new Error("bad listener");
		});
		b.events.on("acme.happened", survivor);
		expect(() => a.events.emit("acme.happened")).not.toThrow();
		expect(survivor).toHaveBeenCalledTimes(1);
	});
});
