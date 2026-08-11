// Shared rig per the test strategy (#28): a REAL MCP SDK client over real
// Streamable HTTP plays the agent; a fake page drives the Switchboard protocol
// straight into the bridge core, standing in for an adapter's channel.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Diagnostic } from "@switchboard-dev/core";
import {
	type Bridge,
	type BridgeOptions,
	createBridge,
	type PageConnection,
} from "../src/node/core";
import { type BridgeServer, startBridgeServer } from "../src/node/http";
import {
	type AnnouncedCommand,
	BRIDGE_PROTOCOL_VERSION,
	type BridgeMessage,
} from "../src/protocol";

export const PAGE_URL = "http://localhost:5173";

export interface TestBridge {
	bridge: Bridge;
	server: BridgeServer;
	url: string;
	diagnostics: Diagnostic[];
	close(): Promise<void>;
}

export async function startTestBridge(
	opts: Partial<BridgeOptions> & {
		idleSessionMs?: number;
		reapIntervalMs?: number;
	} = {},
): Promise<TestBridge> {
	const diagnostics: Diagnostic[] = [];
	const bridge = createBridge({
		pageUrlHint: PAGE_URL,
		diagnostics: (d) => diagnostics.push(d),
		...opts,
	});
	const server = await startBridgeServer({
		bridge,
		port: 0, // ephemeral for tests; the 7654 default has its own suite
		idleSessionMs: opts.idleSessionMs,
		reapIntervalMs: opts.reapIntervalMs,
	});
	return {
		bridge,
		server,
		url: server.url,
		diagnostics,
		async close() {
			await server.close();
			bridge.dispose();
		},
	};
}

export async function connectClient(url: string, name = "conformance-client") {
	const client = new Client({ name, version: "0.0.0" });
	const transport = new StreamableHTTPClientTransport(new URL(url));
	await client.connect(transport);
	return {
		client,
		transport,
		// A well-behaved 2025-era client DELETEs its session on shutdown.
		close: async () => {
			await transport.terminateSession().catch(() => {});
			await client.close();
		},
	};
}

export async function callTool(
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
	signal?: AbortSignal,
) {
	return (await client.callTool(
		{ name, arguments: args },
		undefined,
		signal ? { signal } : undefined,
	)) as CallToolResult;
}

export function resultText(r: CallToolResult): string {
	const first = r.content?.[0];
	return first && first.type === "text" ? first.text : "";
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── The fake page ────────────────────────────────────────────────────────

type InvokeHandler = (
	input: object | undefined,
	signal: AbortSignal,
) => Promise<{ ok: true; value: unknown } | { ok: false; message: string }>;

export interface FakePageOptions {
	protocolVersion?: number;
	kernelApiVersion?: string;
}

/** The demo plugin id every default command/event/context act is tagged with. */
export const DEMO_PLUGIN = "acme.demo";

export class FakePage {
	readonly conn: PageConnection & { closed: boolean };
	received: BridgeMessage[] = [];
	helloOk: Extract<BridgeMessage, { type: "hello-ok" }> | null = null;
	helloReject: Extract<BridgeMessage, { type: "hello-reject" }> | null = null;

	private handlers = new Map<string, InvokeHandler>();
	private aborters = new Map<string, AbortController>();
	private context = new Map<
		string,
		{ value: unknown; pluginId?: string; granted: boolean }
	>();

	constructor(
		private bridge: Bridge,
		private opts: FakePageOptions = {},
	) {
		// biome-ignore lint/suspicious/noExplicitAny: test double wires itself up
		const self = this as any;
		this.conn = {
			closed: false,
			send: (msg: BridgeMessage) => self.onBridgeMessage(msg),
			close: () => {
				this.conn.closed = true;
			},
		};
	}

	get tabId(): string | undefined {
		return this.helloOk?.tabId;
	}

	connect(): void {
		this.bridge.handlePageMessage(this.conn, {
			type: "hello",
			protocolVersion: this.opts.protocolVersion ?? BRIDGE_PROTOCOL_VERSION,
			kernelApiVersion: this.opts.kernelApiVersion ?? "0.1.0-test",
		});
	}

	disconnect(): void {
		this.bridge.handlePageDisconnect(this.conn);
	}

	focus(): void {
		this.bridge.handlePageMessage(this.conn, { type: "focus" });
	}

	send(msg: unknown): void {
		this.bridge.handlePageMessage(this.conn, msg);
	}

	snapshot(commands: AnnouncedCommand[]): void {
		this.bridge.handlePageMessage(this.conn, { type: "snapshot", commands });
	}

	pushEvent(name: string, payload?: unknown, pluginId = DEMO_PLUGIN): void {
		this.bridge.handlePageMessage(this.conn, {
			type: "event",
			name,
			payload,
			pluginId,
			timestamp: Date.now(),
		});
	}

	setContext(
		key: string,
		value: unknown,
		{ pluginId = DEMO_PLUGIN, granted = true } = {},
	): void {
		this.context.set(key, { value, pluginId, granted });
	}

	onInvoke(command: string, handler: InvokeHandler): void {
		this.handlers.set(command, handler);
	}

	private onBridgeMessage(msg: BridgeMessage): void {
		this.received.push(msg);
		switch (msg.type) {
			case "hello-ok":
				this.helloOk = msg;
				return;
			case "hello-reject":
				this.helloReject = msg;
				return;
			case "invoke": {
				// §7.2 — the message loop stays unblocked: dispatch runs detached.
				const handler = this.handlers.get(msg.command);
				const controller = new AbortController();
				this.aborters.set(msg.id, controller);
				void (async () => {
					if (!handler) {
						this.bridge.handlePageMessage(this.conn, {
							type: "result",
							id: msg.id,
							ok: false,
							error: { message: `command '${msg.command}' is not available` },
						});
						return;
					}
					const outcome = await handler(msg.input, controller.signal);
					this.aborters.delete(msg.id);
					this.bridge.handlePageMessage(
						this.conn,
						outcome.ok
							? { type: "result", id: msg.id, ok: true, value: outcome.value }
							: {
									type: "result",
									id: msg.id,
									ok: false,
									error: { message: outcome.message },
								},
					);
				})();
				return;
			}
			case "cancel": {
				this.aborters.get(msg.id)?.abort();
				this.aborters.delete(msg.id);
				return;
			}
			case "context-read": {
				const entry = this.context.get(msg.key);
				if (!entry) {
					this.bridge.handlePageMessage(this.conn, {
						type: "context-value",
						id: msg.id,
						present: false,
						reason: "unset",
					});
				} else if (!entry.granted) {
					// §8.2 — a value exists but its writer holds no grant.
					this.bridge.handlePageMessage(this.conn, {
						type: "context-value",
						id: msg.id,
						present: false,
						reason: "not-granted",
					});
				} else {
					this.bridge.handlePageMessage(this.conn, {
						type: "context-value",
						id: msg.id,
						present: true,
						value: entry.value,
						pluginId: entry.pluginId,
					});
				}
				return;
			}
		}
	}
}

/** The spike's demo surface, as announced commands (§6.1 shapes). */
export function demoCommands(): AnnouncedCommand[] {
	return [
		{
			id: "demo.echo",
			title: "Echo",
			description: "Echo a message back",
			inputSchema: {
				type: "object",
				properties: { message: { type: "string" } },
				required: ["message"],
				additionalProperties: false,
			},
			outputSchema: {
				type: "object",
				properties: { echoed: { type: "string" }, ts: { type: "number" } },
				required: ["echoed", "ts"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			pluginId: DEMO_PLUGIN,
		},
		{
			id: "demo.slow",
			title: "Slow",
			description: "Runs until cancelled",
			pluginId: DEMO_PLUGIN,
		},
		{
			id: "demo.throws",
			title: "Throws",
			pluginId: DEMO_PLUGIN,
		},
		{
			id: "demo.bad-output",
			title: "Bad output",
			outputSchema: {
				type: "object",
				properties: { n: { type: "number" } },
				required: ["n"],
				additionalProperties: false,
			},
			pluginId: DEMO_PLUGIN,
		},
	];
}

/** Wire the demo handlers onto a FakePage, mirroring the spike's page stub. */
export function installDemoHandlers(page: FakePage): void {
	page.onInvoke("demo.echo", async (input) => ({
		ok: true,
		value: { echoed: (input as { message: string }).message, ts: Date.now() },
	}));
	page.onInvoke("demo.slow", (_input, signal) => {
		return new Promise((resolve) => {
			signal.addEventListener("abort", () => {
				page.pushEvent("demo.aborted", { reason: "signal" });
				resolve({ ok: false, message: "aborted" });
			});
		});
	});
	page.onInvoke("demo.throws", async () => ({
		ok: false,
		message: "exploded on purpose",
	}));
	page.onInvoke("demo.bad-output", async () => ({
		ok: true,
		value: { oops: true },
	}));
}

/** Connect a fake page and announce the demo surface in one move. */
export function connectDemoPage(
	bridge: Bridge,
	opts?: FakePageOptions,
): FakePage {
	const page = new FakePage(bridge, opts);
	installDemoHandlers(page);
	page.connect();
	page.snapshot(demoCommands());
	return page;
}
