// The channel-agnostic bridge core (bridge spec §1): adapters ferry wire
// messages over whatever duplex channel they have; this module only sees
// PageConnection. Ported from spikes/mcp-bridge-transport (wayfinder #9),
// conformed to the normative wire shapes of bridge spec §4–§9, §13–§14.

import { randomUUID } from "node:crypto";
import pkg from "../../package.json";
import {
	BRIDGE_PROTOCOL_VERSION,
	type BridgeMessage,
	type PageMessage,
	type WireCommand,
} from "../protocol";
import {
	createDiagnostics,
	type DiagnosticWriter,
	type EmitDiagnostic,
} from "./diagnostics";

/** What an adapter must provide per connected page (one channel lifetime). */
export interface PageConnection {
	send(msg: BridgeMessage): void;
	/** §5.3 / §4.3: the bridge closes rejected or misbehaving connections. */
	close?(): void;
}

export interface BridgeOptions {
	/**
	 * Kernel API semver carried in the handshake and `switchboard.status` —
	 * diagnostics only, never a gate (§2). Defaults to this package's own
	 * version, which fixed-mode releases keep equal to `core`'s.
	 */
	kernelApiVersion?: string;
	/** §7.4 — default 60 000. */
	invokeTimeoutMs?: number;
	/** §14.2 — default 3 000, sized so an ordinary reload reconnects inside it. */
	gracePeriodMs?: number;
	/** §9.2 — tail-buffer capacity, default 100. */
	tailBufferSize?: number;
	/** Where a human should point a browser; used in actionable errors (§10.5). */
	pageUrlHint?: string;
	/** Diagnostics sink; defaults to stderr JSON lines (diagnostics §8). */
	diagnostics?: DiagnosticWriter;
}

interface TabState {
	tabId: string;
	kernelApiVersion: string;
	connectedAt: number;
	focusedAt: number;
	conn: PageConnection;
	commands: WireCommand[];
}

/** §9.2 — one tail-buffer entry: the pushed fields plus tabId and seq. */
export interface TailEntry {
	seq: number;
	name: string;
	payload?: unknown;
	pluginId: string;
	tabId: string;
	timestamp: number;
}

export type InvokeOutcome =
	| { ok: true; value: unknown }
	| { ok: false; error: string };

export type ContextReadOutcome =
	| { ok: true; value: unknown; pluginId?: string }
	| { ok: false; error: string };

interface PendingInvoke {
	conn: PageConnection;
	resolve: (outcome: InvokeOutcome) => void;
	timer?: ReturnType<typeof setTimeout>;
	onAbort?: () => void;
	signal?: AbortSignal;
}

interface PendingContextRead {
	conn: PageConnection;
	resolve: (outcome: ContextReadOutcome) => void;
	timer?: ReturnType<typeof setTimeout>;
}

/** A hook the MCP layer registers per agent session for list_changed fan-out. */
export interface RegistryListener {
	onRegistryChanged(): void;
}

const NO_PAGE = "no page connected";

export class Bridge {
	readonly kernelApiVersion: string;
	readonly invokeTimeoutMs: number;
	readonly gracePeriodMs: number;
	readonly tailBufferSize: number;
	readonly pageUrlHint: string;
	readonly emitDiagnostic: EmitDiagnostic;

	private tabs = new Map<PageConnection, TabState>();
	private activeTab: TabState | null = null;

	/** §6.3 — the one canonical registry `tools/list` is built from. */
	private commands = new Map<string, WireCommand>();

	private pendingInvokes = new Map<string, PendingInvoke>();
	private pendingContextReads = new Map<string, PendingContextRead>();

	private tail: TailEntry[] = [];
	private tailSeq = 0;

	private listeners = new Set<RegistryListener>();
	private notifyTimer: ReturnType<typeof setTimeout> | null = null;
	private graceTimer: ReturnType<typeof setTimeout> | null = null;

	/** §5.3 — the most recent handshake rejection, reported via status. */
	lastRejection: {
		at: number;
		reason: string;
		pageProtocolVersion: number;
		pageKernelApiVersion: string;
	} | null = null;

	constructor(opts: BridgeOptions = {}) {
		this.kernelApiVersion = opts.kernelApiVersion ?? pkg.version;
		this.invokeTimeoutMs = opts.invokeTimeoutMs ?? 60_000;
		this.gracePeriodMs = opts.gracePeriodMs ?? 3_000;
		this.tailBufferSize = opts.tailBufferSize ?? 100;
		this.pageUrlHint = opts.pageUrlHint ?? "your app's dev URL";
		this.emitDiagnostic = createDiagnostics(opts.diagnostics);
	}

	// ── MCP-session fan-out ────────────────────────────────────────────

	addListener(l: RegistryListener): () => void {
		this.listeners.add(l);
		return () => this.listeners.delete(l);
	}

	get agentSessionCount(): number {
		return this.listeners.size;
	}

	/** §6.3 — debounced so a burst of changes yields ONE notification. */
	private scheduleNotify() {
		if (this.notifyTimer) return;
		this.notifyTimer = setTimeout(() => {
			this.notifyTimer = null;
			for (const l of this.listeners) l.onRegistryChanged();
		}, 20);
	}

	// ── Page channel ───────────────────────────────────────────────────

	/**
	 * Feed one already-parsed wire message from a page connection. Unparseable
	 * input is the adapter's to report (§4.3) — it owns deserialization.
	 */
	handlePageMessage(conn: PageConnection, msg: unknown): void {
		if (
			typeof msg !== "object" ||
			msg === null ||
			typeof (msg as { type?: unknown }).type !== "string"
		) {
			// §4.3 — malformed (no `type`): loud; the receiver MAY close.
			this.emitDiagnostic({
				severity: "error",
				code: "malformed-message",
				message: "received a wire message with no `type` discriminator",
			});
			return;
		}
		const m = msg as PageMessage & { type: string };
		switch (m.type) {
			case "hello":
				this.handleHello(conn, m);
				return;
			case "snapshot": {
				const tab = this.tabs.get(conn);
				if (!tab) {
					this.preHandshake(m.type);
					return;
				}
				if (!Array.isArray(m.commands)) {
					this.emitDiagnostic({
						severity: "error",
						code: "malformed-message",
						subject: "snapshot",
						message: "snapshot.commands is not an array",
					});
					return;
				}
				tab.commands = m.commands;
				if (tab === this.activeTab) this.applyActiveSnapshot();
				return;
			}
			case "focus": {
				const tab = this.tabs.get(conn);
				if (!tab) {
					this.preHandshake(m.type);
					return;
				}
				tab.focusedAt = Date.now();
				if (this.activeTab !== tab) {
					// §13.2 — a legal over-time list change, delivered as a diff.
					this.activeTab = tab;
					this.applyActiveSnapshot();
				}
				return;
			}
			case "result": {
				const pending = this.pendingInvokes.get(m.id);
				if (!pending) return; // §7.3 — late result after cancel/timeout: discarded
				this.settleInvoke(
					m.id,
					pending,
					m.ok
						? { ok: true, value: m.value }
						: { ok: false, error: m.error?.message ?? "command failed" },
				);
				return;
			}
			case "context-value": {
				const pending = this.pendingContextReads.get(m.id);
				if (!pending) return;
				this.pendingContextReads.delete(m.id);
				if (pending.timer) clearTimeout(pending.timer);
				if (m.present) {
					pending.resolve({ ok: true, value: m.value, pluginId: m.pluginId });
				} else {
					// §8.2 — the reason makes the built-in's answer actionable.
					pending.resolve({
						ok: false,
						error:
							m.reason === "not-granted"
								? "a value exists but its writer does not hold `bridge:context` — it is not agent-visible"
								: "the key is unset — no plugin has written it",
					});
				}
				return;
			}
			case "event": {
				const tab = this.tabs.get(conn);
				if (!tab) {
					this.preHandshake(m.type);
					return;
				}
				// §9.2 — the bridge is a subscriber keeping notes, nothing more.
				this.tail.push({
					seq: ++this.tailSeq,
					name: m.name,
					payload: m.payload,
					pluginId: m.pluginId,
					tabId: tab.tabId,
					timestamp: m.timestamp,
				});
				if (this.tail.length > this.tailBufferSize) this.tail.shift();
				return;
			}
			default: {
				// §4.3 — unknown message types are tolerated, with a diagnostic.
				const unknownType = (msg as { type: string }).type;
				this.emitDiagnostic({
					severity: "warning",
					code: "unknown-wire-data",
					subject: unknownType,
					message: `ignoring unknown wire message type '${unknownType}'`,
				});
				return;
			}
		}
	}

	private preHandshake(type: string): void {
		// §5.1 — the page MUST NOT send anything else before hello-ok.
		this.emitDiagnostic({
			severity: "error",
			code: "malformed-message",
			subject: type,
			message: `received '${type}' on a connection that has not completed the handshake`,
		});
	}

	private handleHello(
		conn: PageConnection,
		m: { protocolVersion?: unknown; kernelApiVersion?: unknown },
	): void {
		if (this.tabs.has(conn)) {
			this.emitDiagnostic({
				severity: "error",
				code: "malformed-message",
				subject: "hello",
				message:
					"received a second `hello` on an already-established connection",
			});
			return;
		}
		const pageVersion = m.protocolVersion;
		const pageKernel =
			typeof m.kernelApiVersion === "string" ? m.kernelApiVersion : "unknown";
		if (pageVersion !== BRIDGE_PROTOCOL_VERSION) {
			// §2 / §5.3 — exact match or a structured rejection, then close.
			const reason = `bridge protocol version mismatch (page v${String(pageVersion)}, bridge v${BRIDGE_PROTOCOL_VERSION}) — Switchboard was updated; reload this tab`;
			this.lastRejection = {
				at: Date.now(),
				reason,
				pageProtocolVersion: typeof pageVersion === "number" ? pageVersion : -1,
				pageKernelApiVersion: pageKernel,
			};
			this.emitDiagnostic({
				severity: "error",
				code: "protocol-mismatch",
				message: reason,
			});
			conn.send({
				type: "hello-reject",
				pageProtocolVersion: typeof pageVersion === "number" ? pageVersion : -1,
				bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
				pageKernelApiVersion: pageKernel,
				bridgeKernelApiVersion: this.kernelApiVersion,
				reason,
			});
			conn.close?.();
			return;
		}
		const tab: TabState = {
			tabId: randomUUID(), // §13.3 — bridge-minted, stable for the connection
			kernelApiVersion: pageKernel,
			connectedAt: Date.now(),
			focusedAt: Date.now(),
			conn,
			commands: [],
		};
		this.tabs.set(conn, tab);
		this.activeTab = tab; // §13.2 fallback — most recently connected
		if (this.graceTimer) {
			// §14.2 — reconnected inside the grace period: no agent-visible churn.
			clearTimeout(this.graceTimer);
			this.graceTimer = null;
		}
		conn.send({
			type: "hello-ok",
			protocolVersion: BRIDGE_PROTOCOL_VERSION,
			kernelApiVersion: this.kernelApiVersion,
			tabId: tab.tabId,
		});
	}

	handlePageDisconnect(conn: PageConnection): void {
		const tab = this.tabs.get(conn);
		if (!tab) return;
		this.tabs.delete(conn);
		// §7.5 — in-flight work on THIS connection fails immediately; the
		// outcome is already unknowable, so the grace period never applies.
		for (const [id, pending] of [...this.pendingInvokes]) {
			if (pending.conn !== conn) continue;
			this.settleInvoke(id, pending, {
				ok: false,
				error: "page disconnected during invocation; outcome unknown",
			});
		}
		for (const [id, pending] of [...this.pendingContextReads]) {
			if (pending.conn !== conn) continue;
			this.pendingContextReads.delete(id);
			if (pending.timer) clearTimeout(pending.timer);
			pending.resolve({
				ok: false,
				error: "page disconnected during context read",
			});
		}
		if (tab !== this.activeTab) return;
		const remaining = [...this.tabs.values()].sort(
			(a, b) => b.focusedAt - a.focusedAt,
		);
		this.activeTab = remaining[0] ?? null;
		if (this.activeTab) {
			// §13.2 — fail over to the most recently focused remaining tab.
			this.applyActiveSnapshot();
			return;
		}
		// §14.2 — commands stay listed for the grace period; only a genuinely
		// absent page shrinks the list.
		if (this.graceTimer) clearTimeout(this.graceTimer);
		this.graceTimer = setTimeout(() => {
			this.graceTimer = null;
			if (this.tabs.size === 0) this.setRegistry([]);
		}, this.gracePeriodMs);
	}

	private applyActiveSnapshot() {
		this.setRegistry(this.activeTab?.commands ?? []);
	}

	/** §6.3 — diff-then-notify: only a real delta reaches the agent surface. */
	private setRegistry(commands: WireCommand[]) {
		const next = new Map(commands.map((c) => [c.id, c]));
		const changed =
			next.size !== this.commands.size ||
			[...next.entries()].some(
				([id, c]) =>
					JSON.stringify(this.commands.get(id)) !== JSON.stringify(c),
			);
		if (!changed) return;
		this.commands = next;
		this.scheduleNotify();
	}

	// ── Agent-facing queries ───────────────────────────────────────────

	listCommands(): WireCommand[] {
		return [...this.commands.values()];
	}

	/** §11.1 — connection, tab, registry, and version truth. */
	status() {
		const connected = this.tabs.size > 0;
		return {
			bridge: {
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				kernelApiVersion: this.kernelApiVersion,
				invokeTimeoutMs: this.invokeTimeoutMs,
				gracePeriodMs: this.gracePeriodMs,
			},
			page: {
				connected,
				activeTabId: this.activeTab?.tabId ?? null,
				tabs: [...this.tabs.values()].map((t) => ({
					tabId: t.tabId,
					kernelApiVersion: t.kernelApiVersion,
					connectedAt: t.connectedAt,
					focusedAt: t.focusedAt,
					commands: t.commands.length,
				})),
			},
			registry: { commands: this.commands.size },
			events: { buffered: this.tail.length, capacity: this.tailBufferSize },
			agentSessions: this.listeners.size,
			lastHandshakeRejection: this.lastRejection,
			hint: connected ? undefined : `${NO_PAGE} — open ${this.pageUrlHint}`,
		};
	}

	/** §11.3 — newest-last, optionally limited and cursored by sequence. */
	tailEvents(limit = 20, sinceSeq?: number): TailEntry[] {
		const entries =
			sinceSeq === undefined
				? this.tail
				: this.tail.filter((e) => e.seq > sinceSeq);
		return entries.slice(-limit);
	}

	/** §8 — a live round-trip to the active tab; no mirror, no cache. */
	async readContext(key: string): Promise<ContextReadOutcome> {
		const active = this.activeTab;
		if (!active) {
			return {
				ok: false,
				error: `cannot read context '${key}': ${NO_PAGE} — open ${this.pageUrlHint}`,
			};
		}
		const id = randomUUID();
		return new Promise<ContextReadOutcome>((resolve) => {
			const timer = setTimeout(() => {
				this.pendingContextReads.delete(id);
				resolve({
					ok: false,
					error: `context read '${key}' timed out after ${this.invokeTimeoutMs}ms`,
				});
			}, this.invokeTimeoutMs);
			this.pendingContextReads.set(id, { conn: active.conn, resolve, timer });
			active.conn.send({ type: "context-read", id, key });
		});
	}

	async invoke(
		command: string,
		input: object | undefined,
		signal?: AbortSignal,
	): Promise<InvokeOutcome> {
		const active = this.activeTab;
		if (!active) {
			// §10.5 / §14.1 — actionable isError, never a protocol "unknown tool".
			return {
				ok: false,
				error: `cannot invoke '${command}': ${NO_PAGE} — open ${this.pageUrlHint} and retry`,
			};
		}
		if (!this.commands.has(command)) {
			return {
				ok: false,
				error: `unknown command '${command}' — it is not in the connected page's registry (check switchboard.status)`,
			};
		}
		const id = randomUUID();
		return new Promise<InvokeOutcome>((resolve) => {
			const pending: PendingInvoke = { conn: active.conn, resolve, signal };
			// §7.4 — expiry fires the cancel path and names command and limit.
			pending.timer = setTimeout(() => {
				active.conn.send({ type: "cancel", id });
				this.settleInvoke(id, pending, {
					ok: false,
					error: `command '${command}' timed out after ${this.invokeTimeoutMs}ms; a cancel was sent to the page`,
				});
			}, this.invokeTimeoutMs);
			if (signal) {
				// §7.3 — agent cancel → wire cancel → the page fires its AbortSignal.
				pending.onAbort = () => {
					active.conn.send({ type: "cancel", id });
					this.settleInvoke(id, pending, {
						ok: false,
						error: `invocation of '${command}' cancelled by agent`,
					});
				};
				if (signal.aborted) pending.onAbort();
				else signal.addEventListener("abort", pending.onAbort, { once: true });
			}
			this.pendingInvokes.set(id, pending);
			active.conn.send({ type: "invoke", id, command, input });
		});
	}

	private settleInvoke(
		id: string,
		pending: PendingInvoke,
		outcome: InvokeOutcome,
	) {
		if (!this.pendingInvokes.has(id)) return;
		this.pendingInvokes.delete(id);
		if (pending.timer) clearTimeout(pending.timer);
		if (pending.signal && pending.onAbort)
			pending.signal.removeEventListener("abort", pending.onAbort);
		pending.resolve(outcome);
	}

	/** Tear down timers so tests and adapters can dispose cleanly. */
	dispose(): void {
		if (this.notifyTimer) clearTimeout(this.notifyTimer);
		if (this.graceTimer) clearTimeout(this.graceTimer);
		this.notifyTimer = null;
		this.graceTimer = null;
	}
}

export function createBridge(opts: BridgeOptions = {}): Bridge {
	return new Bridge(opts);
}
