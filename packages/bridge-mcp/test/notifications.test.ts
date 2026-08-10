import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
	connectClient,
	connectDemoPage,
	demoCommands,
	sleep,
	startTestBridge,
} from "./harness";

// Bridge spec §6.3/§10.1 — applied deltas propagate as ONE batched
// tools/list_changed per agent session per debounced registry change, and
// notifications stay lossy hints: a client that ignores them and re-lists
// still sees the truth.

describe("bridge §6.3 change notifications over MCP", () => {
	it("a page connecting fans out one list_changed per live session, and re-listing shows the truth", async () => {
		const rig = await startTestBridge();
		const a = await connectClient(rig.url, "client-a");
		const b = await connectClient(rig.url, "client-b");
		let aNotified = 0;
		let bNotified = 0;
		a.client.setNotificationHandler(
			ToolListChangedNotificationSchema,
			async () => {
				aNotified++;
			},
		);
		b.client.setNotificationHandler(
			ToolListChangedNotificationSchema,
			async () => {
				bNotified++;
			},
		);

		connectDemoPage(rig.bridge); // one debounced registry change
		await sleep(300);
		expect(aNotified).toBe(1);
		expect(bNotified).toBe(1);

		// §10.1 — tools/list is rebuilt from the canonical registry on every
		// call; the notification was never load-bearing.
		const names = (await a.client.listTools()).tools.map((t) => t.name);
		expect(names).toContain("demo.echo");
		await a.close();
		await b.close();
		await rig.close();
	});

	it("an unchanged surface never notifies; a real delta notifies once", async () => {
		const rig = await startTestBridge();
		const page = connectDemoPage(rig.bridge);
		const { client, close } = await connectClient(rig.url);
		let notified = 0;
		client.setNotificationHandler(
			ToolListChangedNotificationSchema,
			async () => {
				notified++;
			},
		);
		await sleep(200);
		notified = 0; // discard anything from the initial connect

		page.snapshot(demoCommands()); // identical — zero agent-visible change
		await sleep(200);
		expect(notified).toBe(0);

		page.snapshot(demoCommands().slice(0, 1)); // a real delta
		await sleep(200);
		expect(notified).toBe(1);
		await close();
		await rig.close();
	});
});
