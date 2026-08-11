import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	callTool,
	connectClient,
	connectDemoPage,
	type FakePage,
	resultText,
	sleep,
	startTestBridge,
	type TestBridge,
} from "./harness";

// The full agent ⇄ bridge ⇄ page round trip (bridge spec §6–§11), ported
// from the spike's `with-page` phase (17 checks): real MCP SDK client over
// real Streamable HTTP, fake page on the Switchboard protocol.

describe("bridge §6–§11 with a connected page", () => {
	let rig: TestBridge;
	let page: FakePage;
	beforeEach(async () => {
		rig = await startTestBridge({ invokeTimeoutMs: 5_000 });
		page = connectDemoPage(rig.bridge);
	});
	afterEach(async () => {
		await rig.close();
	});

	it("§6.2/§10.2: page commands appear as MCP tools alongside the built-ins", async () => {
		const { client, close } = await connectClient(rig.url);
		const names = (await client.listTools()).tools.map((t) => t.name);
		expect(names).toContain("demo.echo");
		expect(names).toContain("demo.slow");
		expect(names).toContain("switchboard.status");
		await close();
	});

	it("§6.2/§10.1: inputSchema and outputSchema pass through verbatim", async () => {
		const { client, close } = await connectClient(rig.url);
		const echo = (await client.listTools()).tools.find(
			(t) => t.name === "demo.echo",
		);
		const inputSchema = echo?.inputSchema as unknown as {
			properties: { message: { type: string } };
		};
		expect(inputSchema.properties.message.type).toBe("string");
		const outputSchema = echo?.outputSchema as { required: string[] };
		expect(outputSchema.required).toContain("echoed");
		await close();
	});

	it("§10.3: declared annotations pass through verbatim", async () => {
		const { client, close } = await connectClient(rig.url);
		const echo = (await client.listTools()).tools.find(
			(t) => t.name === "demo.echo",
		);
		expect(echo?.annotations?.readOnlyHint).toBe(true);
		expect(echo?.annotations?.openWorldHint).toBe(false);
		await close();
	});

	it("§10.3: a command with no openWorldHint gets openWorldHint:false supplied", async () => {
		const { client, close } = await connectClient(rig.url);
		const slow = (await client.listTools()).tools.find(
			(t) => t.name === "demo.slow",
		);
		expect(slow?.annotations?.openWorldHint).toBe(false);
		await close();
	});

	it("§10.3: every page tool is tagged with its owning plugin id in _meta", async () => {
		const { client, close } = await connectClient(rig.url);
		const echo = (await client.listTools()).tools.find(
			(t) => t.name === "demo.echo",
		);
		expect(echo?._meta?.["switchboard/pluginId"]).toBe("acme.demo");
		await close();
	});

	it("§11.1: status shows the connected page with its stable tab id", async () => {
		const { client, close } = await connectClient(rig.url);
		const s = (await callTool(client, "switchboard.status"))
			.structuredContent as {
			page: { connected: boolean; activeTabId: string | null };
		};
		expect(s.page.connected).toBe(true);
		expect(s.page.activeTabId).toBe(page.tabId);
		await close();
	});

	it("§11.1/§10.1: status counts live agent sessions (one Server per session)", async () => {
		const a = await connectClient(rig.url, "client-a");
		const b = await connectClient(rig.url, "client-b");
		const s = (await callTool(a.client, "switchboard.status"))
			.structuredContent as {
			agentSessions: number;
		};
		expect(s.agentSessions).toBe(2);
		await a.close();
		await b.close();
	});

	it("§11.1/§2: status reports the page's kernel API version, diagnostics only", async () => {
		const { client, close } = await connectClient(rig.url);
		const s = (await callTool(client, "switchboard.status"))
			.structuredContent as {
			page: { tabs: { kernelApiVersion: string }[] };
		};
		expect(s.page.tabs[0]?.kernelApiVersion).toBe("0.1.0-test");
		await close();
	});

	it("§7.1: the invoke round trip returns conforming structured output", async () => {
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "demo.echo", { message: "round-trip!" });
		const out = r.structuredContent as { echoed: string; ts: number };
		expect(r.isError).not.toBe(true);
		expect(out.echoed).toBe("round-trip!");
		expect(typeof out.ts).toBe("number");
		await close();
	});

	it("§10.4: an outputSchema violation becomes an isError naming the command", async () => {
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "demo.bad-output");
		expect(r.isError).toBe(true);
		expect(resultText(r)).toContain("demo.bad-output");
		expect(resultText(r)).toContain("outputSchema");
		await close();
	});

	it("§7.1/§10.5: a handler failure answers as isError with the handler's message", async () => {
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "demo.throws");
		expect(r.isError).toBe(true);
		expect(resultText(r)).toContain("exploded on purpose");
		await close();
	});

	it("§8.1/§11.2: a context read is a live round trip returning value and writer", async () => {
		page.setContext("demo.counter", 13);
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "switchboard.context.read", {
			key: "demo.counter",
		});
		const out = r.structuredContent as { value: number; pluginId: string };
		expect(r.isError).not.toBe(true);
		expect(out.value).toBe(13);
		expect(out.pluginId).toBe("acme.demo");
		await close();
	});

	it("§8.2/§11.2: an unset context key errors actionably, naming the key", async () => {
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "switchboard.context.read", {
			key: "nope",
		});
		expect(r.isError).toBe(true);
		expect(resultText(r)).toContain("nope");
		expect(resultText(r)).toContain("unset");
		await close();
	});

	it("§8.2: a value whose writer holds no bridge:context grant reads as not-granted", async () => {
		page.setContext("demo.secret", 42, { granted: false });
		const { client, close } = await connectClient(rig.url);
		const r = await callTool(client, "switchboard.context.read", {
			key: "demo.secret",
		});
		expect(r.isError).toBe(true);
		expect(resultText(r)).toContain("not");
		expect(resultText(r)).toContain("bridge:context");
		await close();
	});

	it("§7.3: agent-side cancel settles the call and fires the page's AbortSignal", async () => {
		const { client, close } = await connectClient(rig.url);
		const controller = new AbortController();
		const slow = callTool(client, "demo.slow", {}, controller.signal);
		setTimeout(() => controller.abort(), 100);
		await slow.then(
			() => {},
			() => {}, // the SDK may reject the aborted call — either way it settles
		);
		await sleep(100);
		const tail = await callTool(client, "switchboard.events.tail", {
			limit: 50,
		});
		const events = (tail.structuredContent as { events: { name: string }[] })
			.events;
		expect(events.some((e) => e.name === "demo.aborted")).toBe(true);
		await close();
	});

	it("§9/§11.3: pushed events are served from the tail buffer with attribution", async () => {
		page.pushEvent("demo.tick", { n: 1 });
		page.pushEvent("demo.tick", { n: 2 });
		const { client, close } = await connectClient(rig.url);
		const tail = await callTool(client, "switchboard.events.tail", {
			limit: 50,
		});
		const events = (
			tail.structuredContent as {
				events: {
					name: string;
					pluginId: string;
					tabId: string;
					seq: number;
				}[];
			}
		).events;
		const ticks = events.filter((e) => e.name === "demo.tick");
		expect(ticks.length).toBe(2);
		expect(ticks[0]?.pluginId).toBe("acme.demo");
		expect(ticks[0]?.tabId).toBe(page.tabId);
		await close();
	});

	it("§13.1: a second agent session sees the identical tool list", async () => {
		const a = await connectClient(rig.url, "client-a");
		const b = await connectClient(rig.url, "client-b");
		const namesA = (await a.client.listTools()).tools.map((t) => t.name).sort();
		const namesB = (await b.client.listTools()).tools.map((t) => t.name).sort();
		expect(namesB).toEqual(namesA);
		await a.close();
		await b.close();
	});
});
