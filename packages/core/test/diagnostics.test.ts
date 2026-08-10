import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiagnosticsHub } from "../src/diagnostics";
import { SwitchboardError } from "../src/errors";

// Diagnostics spec — the machinery behind "loud" and "dev-mode warning",
// which kernel §2–§4 lean on. Conformance tests match on `code`, never
// on message prose (diagnostics §3).

afterEach(() => {
	vi.restoreAllMocks();
});

describe("diagnostics §3 named errors: SwitchboardError", () => {
	it("carries name, stable code, and stamped attribution", () => {
		const err = new SwitchboardError({
			code: "invalid-name",
			source: "kernel",
			plugin: "acme.perf-panel",
			subject: "Bad_Name",
			message: "free-form prose",
		});
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("SwitchboardError");
		expect(err.code).toBe("invalid-name");
		expect(err.source).toBe("kernel");
		expect(err.plugin).toBe("acme.perf-panel");
		expect(err.subject).toBe("Bad_Name");
	});
});

describe("diagnostics §6 the channel", () => {
	it("delivers every entry to every current subscriber", () => {
		const hub = createDiagnosticsHub({ dev: true, console: false });
		const a = vi.fn();
		const b = vi.fn();
		hub.subscribe(a);
		hub.subscribe(b);
		hub.emit({
			severity: "error",
			code: "invalid-manifest",
			source: "kernel",
			message: "x",
		});
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
		expect(a.mock.calls[0][0]).toMatchObject({
			severity: "error",
			code: "invalid-manifest",
			source: "kernel",
		});
		expect(typeof a.mock.calls[0][0].timestamp).toBe("number");
	});

	it("is strictly ephemeral — a late subscriber missed it (§6)", () => {
		const hub = createDiagnosticsHub({ dev: true, console: false });
		hub.emit({
			severity: "warning",
			code: "manifest-drift",
			source: "kernel",
			message: "x",
		});
		const late = vi.fn();
		hub.subscribe(late);
		expect(late).not.toHaveBeenCalled();
	});

	it("a throwing subscriber MUST NOT prevent delivery to the others (§6)", () => {
		const hub = createDiagnosticsHub({ dev: true, console: false });
		hub.subscribe(() => {
			throw new Error("bad subscriber");
		});
		const ok = vi.fn();
		hub.subscribe(ok);
		expect(() =>
			hub.emit({
				severity: "error",
				code: "setup-failed",
				source: "kernel",
				message: "x",
			}),
		).not.toThrow();
		expect(ok).toHaveBeenCalledTimes(1);
	});

	it("subscribe returns a Disposable that unsubscribes", () => {
		const hub = createDiagnosticsHub({ dev: true, console: false });
		const cb = vi.fn();
		const sub = hub.subscribe(cb);
		sub.dispose();
		hub.emit({
			severity: "error",
			code: "name-taken",
			source: "kernel",
			message: "x",
		});
		expect(cb).not.toHaveBeenCalled();
	});
});

describe("diagnostics §2.2 / §7 dev mode gates warnings only", () => {
	it("drops warnings when dev is off — they are not emitted at all", () => {
		const hub = createDiagnosticsHub({ dev: false, console: false });
		const cb = vi.fn();
		hub.subscribe(cb);
		hub.emit({
			severity: "warning",
			code: "unknown-permission",
			source: "kernel",
			message: "x",
		});
		expect(cb).not.toHaveBeenCalled();
	});

	it("errors still emit when dev is off — loud errors are unconditional (§2.1)", () => {
		const hub = createDiagnosticsHub({ dev: false, console: false });
		const cb = vi.fn();
		hub.subscribe(cb);
		hub.emit({
			severity: "error",
			code: "setup-failed",
			source: "kernel",
			message: "x",
		});
		expect(cb).toHaveBeenCalledTimes(1);
	});
});

describe("diagnostics §6.3 the default console reporter", () => {
	it("routes error → console.error and warning → console.warn when active", () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const hub = createDiagnosticsHub({ dev: true, console: true });
		hub.emit({
			severity: "error",
			code: "invalid-manifest",
			source: "kernel",
			message: "x",
		});
		hub.emit({
			severity: "warning",
			code: "manifest-drift",
			source: "kernel",
			message: "x",
		});
		expect(err).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
		// output SHOULD include the code
		expect(JSON.stringify(err.mock.calls[0])).toContain("invalid-manifest");
	});

	it("is off when console: false — the channel still fires", () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const hub = createDiagnosticsHub({ dev: true, console: false });
		const cb = vi.fn();
		hub.subscribe(cb);
		hub.emit({
			severity: "error",
			code: "invalid-manifest",
			source: "kernel",
			message: "x",
		});
		expect(err).not.toHaveBeenCalled();
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("is off when dev mode is off, even for errors (§6.3: active iff dev on)", () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const hub = createDiagnosticsHub({ dev: false, console: true });
		hub.emit({
			severity: "error",
			code: "invalid-manifest",
			source: "kernel",
			message: "x",
		});
		expect(err).not.toHaveBeenCalled();
	});
});
