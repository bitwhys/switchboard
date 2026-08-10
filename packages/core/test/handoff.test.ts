import { afterEach, describe, expect, it, vi } from "vitest";
import { createKernelHandoff, type KernelHandoff } from "../src/handoff";
import { createSwitchboard } from "../src/switchboard";

// Kernel spec §17 — the kernel handoff: `globalThis.__SWITCHBOARD__` as
// a tiny push/subscribe object; order-independent discovery, first live
// kernel wins, retraction as the HMR escape hatch.

const options = () => ({
	plugins: [],
	diagnostics: { console: false },
});

function handoffGlobal(): KernelHandoff | undefined {
	return (globalThis as { __SWITCHBOARD__?: KernelHandoff }).__SWITCHBOARD__;
}

afterEach(() => {
	delete (globalThis as { __SWITCHBOARD__?: KernelHandoff }).__SWITCHBOARD__;
});

describe("kernel §17.1 the handoff point", () => {
	it("subscribe replays every live kernel synchronously in announce order, then fires per push (§17.1)", () => {
		const handoff = createKernelHandoff();
		handoff.push("k1");
		handoff.push("k2");
		const seen: unknown[] = [];
		handoff.subscribe((k) => seen.push(k));
		expect(seen).toEqual(["k1", "k2"]); // synchronous replay
		handoff.push("k3");
		expect(seen).toEqual(["k1", "k2", "k3"]); // live push
	});

	it("subscribe returns an unsubscribe function (§17.1)", () => {
		const handoff = createKernelHandoff();
		const cb = vi.fn();
		const unsubscribe = handoff.subscribe(cb);
		unsubscribe();
		handoff.push("k1");
		expect(cb).not.toHaveBeenCalled();
	});

	it("createSwitchboard announces on the global, synchronously inside the call (§17.1)", () => {
		const kernel = createSwitchboard(options());
		const seen: unknown[] = [];
		handoffGlobal()?.subscribe((k) => seen.push(k));
		expect(seen).toEqual([kernel]);
		kernel.dispose();
	});

	it("whichever code touches the global first creates it; the kernel reuses a consumer's copy (§17.1)", () => {
		// a consumer (with its own inline shim) runs before any kernel code
		const consumers = createKernelHandoff();
		(globalThis as { __SWITCHBOARD__?: KernelHandoff }).__SWITCHBOARD__ =
			consumers;
		const seen: unknown[] = [];
		consumers.subscribe((k) => seen.push(k));
		const kernel = createSwitchboard(options());
		expect(handoffGlobal()).toBe(consumers); // reused, not replaced
		expect(seen).toEqual([kernel]); // order-independence: consumer first
		kernel.dispose();
	});
});

describe("kernel §17.2 first live kernel wins", () => {
	it("a second kernel while the first is live gets a dev-mode `duplicate-kernel` warning on its own channel (§17.2)", async () => {
		const first = createSwitchboard(options());
		const second = createSwitchboard(options());
		const firstDiagnostics = vi.fn();
		const secondDiagnostics = vi.fn();
		first.diagnostics.subscribe(firstDiagnostics);
		second.diagnostics.subscribe(secondDiagnostics);
		await second.ready;
		expect(secondDiagnostics).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "warning",
				code: "duplicate-kernel",
			}),
		);
		expect(firstDiagnostics).not.toHaveBeenCalled();
		first.dispose();
		second.dispose();
	});

	it("the warning is dev-mode: dropped when dev is off (§17.2, diagnostics §2.2)", async () => {
		const first = createSwitchboard(options());
		const second = createSwitchboard({ ...options(), dev: false });
		const diagnostics = vi.fn();
		second.diagnostics.subscribe(diagnostics);
		await second.ready;
		expect(diagnostics).not.toHaveBeenCalled();
		first.dispose();
		second.dispose();
	});
});

describe("kernel §17.3 retraction", () => {
	it("dispose retracts the announce: no replay, and dispose-then-construct trips no warning (§17.3)", async () => {
		const first = createSwitchboard(options());
		first.dispose();
		const seen: unknown[] = [];
		handoffGlobal()?.subscribe((k) => seen.push(k));
		expect(seen).toEqual([]); // a retracted kernel never appears in replay
		const second = createSwitchboard(options());
		const diagnostics = vi.fn();
		second.diagnostics.subscribe(diagnostics);
		await second.ready;
		expect(diagnostics).not.toHaveBeenCalled(); // the HMR escape hatch
		second.dispose();
	});

	it("subscribers learn of a retraction through onRetract (§17.3)", () => {
		const kernel = createSwitchboard(options());
		const onRetract = vi.fn();
		handoffGlobal()?.subscribe(() => {}, onRetract);
		kernel.dispose();
		expect(onRetract).toHaveBeenCalledWith(kernel);
	});

	it("retract with a never-announced or already-retracted kernel is a no-op (§17.3)", () => {
		const handoff = createKernelHandoff();
		const onRetract = vi.fn();
		handoff.subscribe(() => {}, onRetract);
		handoff.retract("never-announced");
		handoff.push("k1");
		handoff.retract("k1");
		handoff.retract("k1"); // already retracted
		expect(onRetract).toHaveBeenCalledTimes(1);
	});
});
