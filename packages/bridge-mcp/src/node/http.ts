// The MCP door over Streamable HTTP (bridge spec §10.1, §15.1–§15.2):
// stateful sessions, Origin allowlist ON, idle-session reaping. Exposed both
// as a mountable Node req/res handler (dev-server middleware — Vite, Next)
// and as a standalone loopback server for adapters that own a bridge port.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server as HttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { SwitchboardError } from "@switchboard-dev/core";
import type { Bridge } from "./core";
import { createMcpSession } from "./mcp";

/** Bridge-port research (#40): inside IANA's Unassigned 7649–7662 row. */
export const DEFAULT_BRIDGE_PORT = 7654;

export interface McpHandlerOptions {
	/**
	 * §15.2 — Origin values admitted at the MCP door. Requests WITHOUT an
	 * Origin header (terminal agents) are always admitted; this list refuses
	 * browser-borne cross-origin traffic.
	 */
	allowedOrigins: string[];
	/** Host-header values admitted (DNS-rebinding refusal). */
	allowedHosts: string[];
	/** §10.1 — idle sessions MUST be reaped. Default 300 000. */
	idleSessionMs?: number;
	/** Reaper sweep cadence. Default 60 000. */
	reapIntervalMs?: number;
}

export interface McpHandler {
	handle(req: IncomingMessage, res: ServerResponse): void;
	/** Live agent-session count (diagnostic; also visible via the bridge). */
	readonly sessionCount: number;
	/** Stop the reaper and close every live session. */
	close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const raw = Buffer.concat(chunks).toString("utf8");
	return raw.length ? JSON.parse(raw) : undefined;
}

export function createMcpHandler(
	bridge: Bridge,
	opts: McpHandlerOptions,
): McpHandler {
	const idleSessionMs = opts.idleSessionMs ?? 300_000;
	const reapIntervalMs = opts.reapIntervalMs ?? 60_000;

	interface Session {
		transport: StreamableHTTPServerTransport;
		lastActivity: number;
	}
	const sessions = new Map<string, Session>();

	// §10.1 — clients are not required to DELETE their session; without
	// server-side GC, abandoned sessions accumulate without bound.
	const reaper = setInterval(() => {
		const cutoff = Date.now() - idleSessionMs;
		for (const [sid, session] of sessions) {
			if (session.lastActivity < cutoff) {
				sessions.delete(sid);
				void session.transport.close();
			}
		}
	}, reapIntervalMs);
	reaper.unref?.();

	async function handleMcp(req: IncomingMessage, res: ServerResponse) {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;
		let body: unknown;
		try {
			body = req.method === "POST" ? await readBody(req) : undefined;
		} catch {
			res.statusCode = 400;
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					jsonrpc: "2.0",
					error: { code: -32700, message: "Parse error" },
					id: null,
				}),
			);
			return;
		}

		if (sessionId && sessions.has(sessionId)) {
			const session = sessions.get(sessionId);
			if (session) {
				session.lastActivity = Date.now();
				// Explicit DELETE is honored with full cleanup (§10.1): the SDK
				// closes the transport, and onclose below removes the session.
				await session.transport.handleRequest(req, res, body);
			}
			return;
		}

		if (req.method === "POST" && isInitializeRequest(body)) {
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: randomUUID,
				// §15.2 — allowlist ON; the SDK admits no-Origin requests, so
				// terminal agents connect with zero config.
				enableDnsRebindingProtection: true,
				allowedOrigins: opts.allowedOrigins,
				allowedHosts: opts.allowedHosts,
				onsessioninitialized: (sid) => {
					sessions.set(sid, { transport, lastActivity: Date.now() });
				},
			});
			// One Server instance per agent session over the ONE registry
			// (§10.1); registry changes fan out as one list_changed each (§6.3).
			const session = createMcpSession(bridge);
			const unsubscribe = bridge.addListener({
				onRegistryChanged: () => void session.sendToolListChanged(),
			});
			transport.onclose = () => {
				unsubscribe();
				if (transport.sessionId) sessions.delete(transport.sessionId);
			};
			await session.connect(transport);
			await transport.handleRequest(req, res, body);
			return;
		}

		// §10.5 — protocol-level errors only for malformed MCP requests.
		res.statusCode = 400;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message:
						"Bad Request: no valid session. POST an initialize request first.",
				},
				id: null,
			}),
		);
	}

	return {
		handle(req, res) {
			void handleMcp(req, res).catch(() => {
				if (!res.headersSent) {
					res.statusCode = 500;
					res.setHeader("content-type", "application/json");
					res.end(
						JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32603, message: "internal error" },
							id: null,
						}),
					);
				}
			});
		},
		get sessionCount() {
			return sessions.size;
		},
		async close() {
			clearInterval(reaper);
			await Promise.all([...sessions.values()].map((s) => s.transport.close()));
			sessions.clear();
		},
	};
}

export interface BridgeServerOptions {
	bridge: Bridge;
	/** Default 7654 (fallbacks 7655/7656 are for HUMANS to configure — §40's
	 * posture: `EADDRINUSE` fails loud, the bridge never scans). */
	port?: number;
	/** Path the MCP endpoint is mounted at. Default `/mcp`. */
	path?: string;
	/** Extra §15.2 origins (the app's dev origins). Loopback origins for the
	 * bridge's own port are always included. */
	allowedOrigins?: string[];
	idleSessionMs?: number;
	reapIntervalMs?: number;
}

export interface BridgeServer {
	/** The URL agents dial. Documentation says `localhost` (§15.1). */
	url: string;
	port: number;
	handler: McpHandler;
	close(): Promise<void>;
}

function listen(server: HttpServer, port: number, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (err: Error) => reject(err);
		server.once("error", onError);
		server.listen(port, host, () => {
			server.removeListener("error", onError);
			resolve();
		});
	});
}

/**
 * Start the bridge's own loopback HTTP server (the Next-style bridge port).
 * §15.1: binds BOTH loopback literals where possible — Node resolves
 * `localhost` inconsistently, and a single-literal bind strands clients on
 * the other one. On `EADDRINUSE` it fails loud and NEVER scans (#40): a
 * scanning bridge that silently moves breaks the hard-coded port in an
 * agent's MCP config, and a sibling bridge must never be reused — a bridge
 * is bound to one page kernel. Adapters let the rejection crash the process.
 */
export async function startBridgeServer(
	opts: BridgeServerOptions,
): Promise<BridgeServer> {
	const { bridge } = opts;
	const requestedPort = opts.port ?? DEFAULT_BRIDGE_PORT;
	const path = opts.path ?? "/mcp";

	let handler: McpHandler | null = null;
	const route = (req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? "";
		if (url === path || url.startsWith(`${path}?`)) {
			handler?.handle(req, res);
			return;
		}
		res.statusCode = 404;
		res.end("not found");
	};

	const v4 = createServer(route);
	try {
		await listen(v4, requestedPort, "127.0.0.1");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
			const message = `port ${requestedPort} is already in use — the Switchboard bridge never scans for a free port. Stop the process holding it (identity-probe it first: another Switchboard bridge here belongs to a DIFFERENT page and must not be reused) or configure a different port (e.g. 7655/7656).`;
			bridge.emitDiagnostic({
				severity: "error",
				code: "port-in-use",
				subject: String(requestedPort),
				message,
			});
			throw new SwitchboardError({
				code: "port-in-use",
				source: "bridge",
				subject: String(requestedPort),
				message,
			});
		}
		throw err;
	}
	const address = v4.address();
	const port =
		typeof address === "object" && address ? address.port : requestedPort;

	// Best-effort second literal (§15.1 SHOULD): tolerate an IPv6-less host,
	// or the ephemeral-port case where ::1 on the same port is taken.
	const v6 = createServer(route);
	let v6Bound = false;
	try {
		await listen(v6, port, "::1");
		v6Bound = true;
	} catch {
		// IPv4-only it is.
	}

	const loopbackOrigins = [
		`http://localhost:${port}`,
		`http://127.0.0.1:${port}`,
		`http://[::1]:${port}`,
	];
	handler = createMcpHandler(bridge, {
		allowedOrigins: [...loopbackOrigins, ...(opts.allowedOrigins ?? [])],
		allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`],
		idleSessionMs: opts.idleSessionMs,
		reapIntervalMs: opts.reapIntervalMs,
	});
	const boundHandler = handler;

	const closeServer = (s: HttpServer) =>
		new Promise<void>((resolve) => {
			s.close(() => resolve());
			s.closeAllConnections?.();
		});

	return {
		url: `http://localhost:${port}${path}`,
		port,
		handler: boundHandler,
		async close() {
			await boundHandler.close();
			await closeServer(v4);
			if (v6Bound) await closeServer(v6);
		},
	};
}
