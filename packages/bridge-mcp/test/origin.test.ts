import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestBridge, type TestBridge } from "./harness";

// Bridge spec §15.2 — the MCP door validates Origin against an allowlist and
// refuses disallowed origins before any protocol processing, while requests
// WITHOUT an Origin header (terminal agents) are admitted. Ported from the
// spike's `origin` phase.

const INIT_BODY = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "origin-probe", version: "0" },
	},
});

const HEADERS = {
	"content-type": "application/json",
	accept: "application/json, text/event-stream",
};

describe("bridge §15.2 Origin allowlist at the MCP door", () => {
	let rig: TestBridge;
	beforeEach(async () => {
		rig = await startTestBridge();
	});
	afterEach(async () => {
		await rig.close();
	});

	it("refuses a disallowed Origin with 403 before any protocol processing", async () => {
		const res = await fetch(rig.url, {
			method: "POST",
			headers: { ...HEADERS, origin: "http://evil.example" },
			body: INIT_BODY,
		});
		expect(res.status).toBe(403);
	});

	it("admits an allowlisted Origin", async () => {
		const res = await fetch(rig.url, {
			method: "POST",
			headers: { ...HEADERS, origin: `http://localhost:${rig.server.port}` },
			body: INIT_BODY,
		});
		expect(res.status).toBe(200);
	});

	it("admits a request without an Origin header (terminal agents)", async () => {
		const res = await fetch(rig.url, {
			method: "POST",
			headers: HEADERS,
			body: INIT_BODY,
		});
		expect(res.status).toBe(200);
	});

	it("refuses a forged Host header (DNS rebinding)", async () => {
		// fetch refuses to forge Host, so speak raw HTTP for this probe.
		const status = await new Promise<number>((resolve, reject) => {
			const req = request(
				{
					host: "127.0.0.1",
					port: rig.server.port,
					path: "/mcp",
					method: "POST",
					headers: { ...HEADERS, host: "attacker.example" },
				},
				(res) => {
					res.resume();
					resolve(res.statusCode ?? 0);
				},
			);
			req.on("error", reject);
			req.end(INIT_BODY);
		});
		expect(status).toBe(403);
	});
});
