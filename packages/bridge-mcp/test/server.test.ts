import type { Diagnostic, SwitchboardError } from "@switchboard-dev/core";
import { describe, expect, it, vi } from "vitest";
import { createBridge } from "../src/node/core";
import {
	createDiagnostics,
	stderrDiagnosticWriter,
} from "../src/node/diagnostics";
import { DEFAULT_BRIDGE_PORT, startBridgeServer } from "../src/node/http";
import { connectClient, sleep, startTestBridge } from "./harness";

// The node-side postures: the default port and the loud, never-scanning
// EADDRINUSE failure (bridge-port research #40; diagnostics §5.2), stderr
// JSON-line diagnostics (diagnostics §8), and idle-session reaping (§10.1).

describe("bridge port posture (#40)", () => {
	it("the default bridge port is 7654", () => {
		expect(DEFAULT_BRIDGE_PORT).toBe(7654);
	});

	it("EADDRINUSE fails loud with a port-in-use SwitchboardError — and never scans", async () => {
		const holder = await startTestBridge();
		const diagnostics: Diagnostic[] = [];
		const bridge = createBridge({ diagnostics: (d) => diagnostics.push(d) });
		await expect(
			startBridgeServer({ bridge, port: holder.server.port }),
		).rejects.toMatchObject({
			name: "SwitchboardError",
			code: "port-in-use",
			source: "bridge",
		});
		// Loud = the same code on the stderr transport (diagnostics §2.1, §8) …
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ severity: "error", code: "port-in-use" }),
		);
		// … and the remedy names the posture: no scanning, no sibling reuse.
		const err = await startBridgeServer({
			bridge,
			port: holder.server.port,
		}).catch((e: SwitchboardError) => e);
		expect((err as SwitchboardError).message).toContain("never scans");
		await holder.close();
	});
});

describe("diagnostics §8 stderr JSON lines", () => {
	it("the default writer emits one JSON object per line with the §4 shape", () => {
		const write = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		try {
			const emit = createDiagnostics(stderrDiagnosticWriter);
			emit({
				severity: "error",
				code: "port-in-use",
				subject: "7654",
				message: "port 7654 is already in use",
			});
			expect(write).toHaveBeenCalledTimes(1);
			const line = write.mock.calls[0]?.[0] as string;
			expect(line.endsWith("\n")).toBe(true);
			const parsed = JSON.parse(line);
			expect(parsed).toMatchObject({
				severity: "error",
				code: "port-in-use",
				source: "bridge",
				subject: "7654",
			});
			expect(typeof parsed.message).toBe("string");
			expect(typeof parsed.timestamp).toBe("number");
		} finally {
			write.mockRestore();
		}
	});
});

describe("bridge §10.1 session lifecycle at the MCP door", () => {
	it("idle sessions are reaped without a client DELETE", async () => {
		const rig = await startTestBridge({
			idleSessionMs: 150,
			reapIntervalMs: 50,
		});
		const { client, transport } = await connectClient(rig.url);
		expect(rig.bridge.agentSessionCount).toBe(1);
		// Abandon the session the rude way: no DELETE, just stop talking.
		await client.close().catch(() => {});
		void transport;
		await sleep(400);
		expect(rig.bridge.agentSessionCount).toBe(0);
		expect(rig.server.handler.sessionCount).toBe(0);
		await rig.close();
	});

	it("an explicit DELETE is honored with full cleanup", async () => {
		const rig = await startTestBridge();
		const session = await connectClient(rig.url);
		expect(rig.bridge.agentSessionCount).toBe(1);
		await session.close(); // terminateSession → HTTP DELETE
		await sleep(50);
		expect(rig.bridge.agentSessionCount).toBe(0);
		expect(rig.server.handler.sessionCount).toBe(0);
		await rig.close();
	});
});
