import type { Diagnostic } from "@switchboard-dev/core";
import { describe, expect, it } from "vitest";
import { createBridge } from "../src/node/core";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol";
import { demoCommands, FakePage } from "./harness";

// Bridge spec §2 (the sole compatibility gate), §5 (handshake), §4.3
// (tolerance posture) and §15.4 (the reserved auth field), driven straight
// into the bridge core. Conformance matches on diagnostic `code`, never
// message prose (diagnostics spec §3).

function rig() {
	const diagnostics: Diagnostic[] = [];
	const bridge = createBridge({ diagnostics: (d) => diagnostics.push(d) });
	return { bridge, diagnostics };
}

describe("bridge §5 handshake", () => {
	it("§5.2: exact protocol-version match answers hello-ok with versions and a tab id", () => {
		const { bridge } = rig();
		const page = new FakePage(bridge);
		page.connect();
		expect(page.helloOk).toMatchObject({
			type: "hello-ok",
			protocolVersion: BRIDGE_PROTOCOL_VERSION,
		});
		expect(typeof page.helloOk?.kernelApiVersion).toBe("string");
		expect(typeof page.helloOk?.tabId).toBe("string");
	});

	it("§5.3/§2: a mismatch answers a structured rejection carrying all four versions, then closes", () => {
		const { bridge, diagnostics } = rig();
		const page = new FakePage(bridge, {
			protocolVersion: 999,
			kernelApiVersion: "9.9.9",
		});
		page.connect();
		expect(page.helloOk).toBeNull();
		expect(page.helloReject).toMatchObject({
			type: "hello-reject",
			pageProtocolVersion: 999,
			bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
			pageKernelApiVersion: "9.9.9",
		});
		expect(typeof page.helloReject?.bridgeKernelApiVersion).toBe("string");
		expect(page.helloReject?.reason).toContain("reload");
		expect(page.conn.closed).toBe(true);
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ severity: "error", code: "protocol-mismatch" }),
		);
	});

	it("§5.3/§11.1: the most recent rejection is recorded and reported via status", () => {
		const { bridge } = rig();
		const page = new FakePage(bridge, { protocolVersion: 0 });
		page.connect();
		const status = bridge.status();
		expect(status.lastHandshakeRejection).toMatchObject({
			pageProtocolVersion: 0,
		});
		expect(status.page.connected).toBe(false);
	});

	it("§5.3/§14: a rejected page is not connected — the page-absent rules apply", async () => {
		const { bridge } = rig();
		const page = new FakePage(bridge, { protocolVersion: 999 });
		page.connect();
		page.snapshot(demoCommands());
		expect(bridge.listCommands()).toEqual([]);
		const outcome = await bridge.invoke("demo.echo", {});
		expect(outcome.ok).toBe(false);
	});

	it("§5.1: a message before the handshake is a loud malformed-message", () => {
		const { bridge, diagnostics } = rig();
		const page = new FakePage(bridge);
		page.snapshot(demoCommands()); // no hello first
		expect(bridge.listCommands()).toEqual([]);
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ severity: "error", code: "malformed-message" }),
		);
	});

	it("§5.1: a second hello on an established connection is a loud malformed-message", () => {
		const { bridge, diagnostics } = rig();
		const page = new FakePage(bridge);
		page.connect();
		page.connect();
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ severity: "error", code: "malformed-message" }),
		);
	});

	it("§15.4: the reserved auth field is carried but ignored in v1", () => {
		const { bridge } = rig();
		const page = new FakePage(bridge);
		bridge.handlePageMessage(page.conn, {
			type: "hello",
			protocolVersion: BRIDGE_PROTOCOL_VERSION,
			kernelApiVersion: "0.1.0-test",
			auth: { token: "ignored" },
		});
		expect(page.helloOk).not.toBeNull();
	});
});

describe("bridge §4.3 tolerance posture", () => {
	it("unknown message types are tolerated with an unknown-message-data warning", () => {
		const { bridge, diagnostics } = rig();
		const page = new FakePage(bridge);
		page.connect();
		page.send({ type: "hologram", beam: true });
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "unknown-message-data",
				subject: "hologram",
			}),
		);
	});

	it("unknown fields on known messages are tolerated", () => {
		const { bridge } = rig();
		const page = new FakePage(bridge);
		bridge.handlePageMessage(page.conn, {
			type: "hello",
			protocolVersion: BRIDGE_PROTOCOL_VERSION,
			kernelApiVersion: "0.1.0-test",
			futureField: "tolerated",
		});
		expect(page.helloOk).not.toBeNull();
	});

	it("a message with no type discriminator is a loud malformed-message", () => {
		const { bridge, diagnostics } = rig();
		const page = new FakePage(bridge);
		page.send({ nonsense: true });
		page.send("not an object");
		expect(
			diagnostics.filter(
				(d) => d.code === "malformed-message" && d.severity === "error",
			).length,
		).toBe(2);
	});

	it("diagnostics carry the bridge's stamped source (diagnostics §4.1)", () => {
		const { bridge, diagnostics } = rig();
		const page = new FakePage(bridge);
		page.send({ nonsense: true });
		expect(diagnostics[0]?.source).toBe("bridge");
		expect(typeof diagnostics[0]?.timestamp).toBe("number");
	});
});
