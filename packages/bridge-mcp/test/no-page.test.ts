import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	callTool,
	connectClient,
	resultText,
	startTestBridge,
	type TestBridge,
} from "./harness";

// Bridge spec §11 & §14.1 — the built-ins are the reliable floor: with no
// page connected the endpoint keeps serving and every answer is actionable.
// Ported from the spike's `no-page` phase (7 checks).

describe("bridge §11/§14.1 no page connected", () => {
	let rig: TestBridge;
	beforeEach(async () => {
		rig = await startTestBridge();
	});
	afterEach(async () => {
		await rig.close();
	});

	it("§11: the tool list is exactly the three switchboard.* built-ins", async () => {
		const { client, close } = await connectClient(rig.url);
		const tools = (await client.listTools()).tools.map((t) => t.name).sort();
		expect(tools).toEqual([
			"switchboard.context.read",
			"switchboard.events.tail",
			"switchboard.status",
		]);
		await close();
	});

	it("§11.1: status says exactly that no page is connected, with the remedy", async () => {
		const { client, close } = await connectClient(rig.url);
		const status = await callTool(client, "switchboard.status");
		const s = status.structuredContent as {
			page: { connected: boolean };
			hint?: string;
		};
		expect(s.page.connected).toBe(false);
		expect(s.hint).toContain("http://localhost:5173");
		await close();
	});

	it("§11.1/§2: status reports the bridge protocol version and kernel API version", async () => {
		const { client, close } = await connectClient(rig.url);
		const status = await callTool(client, "switchboard.status");
		const s = status.structuredContent as {
			bridge: { protocolVersion: number; kernelApiVersion: string };
		};
		expect(s.bridge.protocolVersion).toBe(1);
		expect(typeof s.bridge.kernelApiVersion).toBe("string");
		await close();
	});

	it("§11.2: context.read fails actionably (isError naming the page URL)", async () => {
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "switchboard.context.read", {
			key: "demo.counter",
		});
		expect(r.isError).toBe(true);
		expect(resultText(r)).toContain("open http");
		await close();
	});

	it("§11.3: events.tail keeps serving its buffer (not an error)", async () => {
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "switchboard.events.tail");
		expect(r.isError).not.toBe(true);
		await close();
	});

	it("§10.5/§14.1: invoking a page command is an actionable isError, never a protocol 'unknown tool'", async () => {
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "demo.echo", { message: "hi" });
		expect(r.isError).toBe(true);
		expect(resultText(r)).toContain("no page connected");
		await close();
	});

	it("§11: built-ins carry closed-world read-only annotations", async () => {
		const { client, close } = await connectClient(rig.url);
		const tools = (await client.listTools()).tools;
		for (const tool of tools) {
			expect(tool.annotations?.readOnlyHint).toBe(true);
			expect(tool.annotations?.openWorldHint).toBe(false);
		}
		await close();
	});
});
