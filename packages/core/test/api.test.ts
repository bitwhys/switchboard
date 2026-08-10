import { describe, expect, it, vi } from "vitest";
import { createKernel } from "../src/kernel";
import type { PluginApi } from "../src/plugin";

// Kernel spec §5 — PluginApi: the plugin's only door, grouped by
// primitive — and §4.3's promise that every registration call returns
// a Disposable the kernel also tracks.

const base = { name: "Test Plugin", version: "1.0.0" };

async function withApi(
	setup?: (api: PluginApi) => void,
): Promise<{ api: PluginApi; dispose: () => void }> {
	let captured: PluginApi | undefined;
	const kernel = createKernel({
		plugins: [
			{
				id: "acme.a",
				...base,
				setup: (api) => {
					captured = api;
					setup?.(api);
				},
			},
		],
		diagnostics: { console: false },
	});
	await kernel.ready;
	if (!captured) throw new Error("setup did not run");
	return { api: captured, dispose: () => kernel.dispose() };
}

describe("kernel §5 PluginApi", () => {
	it("setup receives the door grouped by primitive plus kernel infrastructure", async () => {
		const { api } = await withApi();
		expect(api.commands).toBeDefined();
		expect(api.events).toBeDefined();
		expect(api.context).toBeDefined();
		expect(api.services).toBeDefined();
		expect(api.diagnostics).toBeDefined();
		expect(typeof api.onDispose).toBe("function");
	});

	it("every registration call returns a Disposable (§4.3)", async () => {
		const { api } = await withApi();
		for (const d of [
			api.commands.register({ id: "acme.cmd", title: "t", execute: () => 0 }),
			api.events.on("acme.happened", () => {}),
			api.context.observe("acme.state", () => {}),
			api.services.register("acme.svc", {}),
		]) {
			expect(typeof d.dispose).toBe("function");
		}
	});

	it("the kernel tracks registrations it handed out: deactivation stops delivery (§4.3)", async () => {
		const onEvent = vi.fn();
		const onContext = vi.fn();
		const { api, dispose } = await withApi((api) => {
			api.events.on("acme.happened", onEvent);
			api.context.observe("acme.state", onContext);
		});
		onContext.mockClear(); // drop the §8.1 replay call
		dispose();
		api.events.emit("acme.happened", 1);
		api.context.set("acme.state", 1);
		expect(onEvent).not.toHaveBeenCalled();
		expect(onContext).not.toHaveBeenCalled();
	});
});
