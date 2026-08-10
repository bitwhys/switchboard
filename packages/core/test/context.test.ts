import { describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { createKernel } from "../src/kernel";
import type { PluginApi } from "../src/plugin";

// Kernel spec §8 — Context: named, observable values with synchronous
// replay on observe, whole-value replace, and no equality dedup.

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

describe("kernel §8.1 replay on observe", () => {
	it("observe MUST fire synchronously on subscribe with the current value", async () => {
		const { a } = await harness();
		a.context.set("acme.count", 41);
		const cb = vi.fn();
		a.context.observe("acme.count", cb);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0]?.[0]).toBe(41);
	});

	it("replay includes undefined when the key was never set — the callback is the complete rendering logic", async () => {
		const { a } = await harness();
		const cb = vi.fn();
		a.context.observe("acme.never-set", cb);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0]?.[0]).toBeUndefined();
	});

	it("after replay, the observer fires on every subsequent set, with the writer stamped in meta", async () => {
		const { a, b } = await harness();
		const cb = vi.fn();
		a.context.observe("acme.count", cb);
		b.context.set("acme.count", 1);
		expect(cb).toHaveBeenCalledTimes(2);
		const [value, meta] = cb.mock.calls[1] ?? [];
		expect(value).toBe(1);
		expect(meta).toEqual({ source: "acme.b", timestamp: expect.any(Number) });
	});
});

describe("kernel §8.2–§8.3 values and notification", () => {
	it("get returns the latest value synchronously; values replace whole", async () => {
		const { a } = await harness();
		a.context.set("acme.state", { mode: "x" });
		a.context.set("acme.state", { other: true });
		expect(a.context.get("acme.state")).toEqual({ other: true });
	});

	it("every set notifies — the kernel performs NO equality dedup", async () => {
		const { a } = await harness();
		const cb = vi.fn();
		a.context.observe("acme.count", cb);
		a.context.set("acme.count", 7);
		a.context.set("acme.count", 7);
		// replay + two sets, same value both times
		expect(cb).toHaveBeenCalledTimes(3);
	});

	it("delete(key) notifies observers with undefined, and get returns undefined after", async () => {
		const { a } = await harness();
		const cb = vi.fn();
		a.context.set("acme.count", 1);
		a.context.observe("acme.count", cb);
		a.context.delete("acme.count");
		expect(cb).toHaveBeenCalledTimes(2);
		expect(cb.mock.calls[1]?.[0]).toBeUndefined();
		expect(a.context.get("acme.count")).toBeUndefined();
	});
});

describe("kernel §8.4 ownership and cleanup", () => {
	it("context keys are an open channel: writes are unrestricted across plugins (§2.2)", async () => {
		const { a, b } = await harness();
		a.context.set("acme.shared", "from-a");
		b.context.set("acme.shared", "from-b");
		expect(a.context.get("acme.shared")).toBe("from-b");
	});

	it("a disposed plugin's keys are NOT auto-deleted — some values legitimately outlive their writer", async () => {
		const { a, kernel } = await harness();
		a.context.set("acme.durable", "still here");
		kernel.dispose();
		expect(a.context.get("acme.durable")).toBe("still here");
	});

	it("observers ARE disposed with their plugin (§4.3), even though values persist", async () => {
		const { a, b, kernel } = await harness();
		const cb = vi.fn();
		a.context.observe("acme.state", cb);
		cb.mockClear();
		kernel.dispose();
		b.context.set("acme.state", 1);
		expect(cb).not.toHaveBeenCalled();
	});
});

describe("kernel §2 naming applied to context", () => {
	it("MUST validate keys with the one shared validator — invalid keys are loud invalid-name errors (§2.1)", async () => {
		const { a, seen } = await harness();
		expect(() => a.context.set("Bad Key", 1)).toThrow(swErr("invalid-name"));
		expect(() => a.context.observe("Bad Key", () => {})).toThrow(
			swErr("invalid-name"),
		);
		expect(seen).toContainEqual(
			expect.objectContaining({ code: "invalid-name", subject: "Bad Key" }),
		);
	});

	it("a plugin MUST NOT set or delete under switchboard.* (§2.4) — reads and observation stay legal", async () => {
		const { a } = await harness();
		expect(() => a.context.set("switchboard.fake", 1)).toThrow(
			swErr("reserved-namespace"),
		);
		expect(() => a.context.delete("switchboard.fake")).toThrow(
			swErr("reserved-namespace"),
		);
		expect(a.context.get("switchboard.something")).toBeUndefined();
		expect(() =>
			a.context.observe("switchboard.something", () => {}),
		).not.toThrow();
	});
});
