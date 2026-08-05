/**
 * Bridge core — channel-agnostic (decision 5: adapters ferry wire messages
 * over whatever duplex channel they have; core only sees PageConnection).
 */
import { randomUUID } from 'node:crypto'
import {
  BRIDGE_PROTOCOL_VERSION,
  KERNEL_API_VERSION,
  type BridgeToPage,
  type PageToBridge,
  type WireCommand,
} from '../wire.js'

/** What an adapter must provide per connected page. */
export interface PageConnection {
  send(msg: BridgeToPage): void
}

export interface BridgeOptions {
  /** Decision 10: generous configurable default. */
  invokeTimeoutMs?: number
  /** Decision 12: sized so a page reload reconnects invisibly. */
  gracePeriodMs?: number
  tailBufferSize?: number
  pageUrlHint?: string
  log?: (line: string) => void
}

export interface TabState {
  tabId: string
  kernelApiVersion: string
  connectedAt: number
  focusedAt: number
  conn: PageConnection
  snapshot: { commands: WireCommand[]; contextKeys: string[] }
}

export interface TailEntry {
  seq: number
  ts: number
  name: string
  pluginId: string
  payload: unknown
}

export type InvokeOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

interface PendingRequest {
  resolve: (outcome: InvokeOutcome) => void
  timer?: ReturnType<typeof setTimeout>
  onAbort?: () => void
  signal?: AbortSignal
}

/** A hook the MCP layer registers per agent session for list_changed fan-out. */
export interface RegistryListener {
  onRegistryChanged(): void
}

export class BridgeCore {
  readonly invokeTimeoutMs: number
  readonly gracePeriodMs: number
  readonly tailBufferSize: number
  readonly pageUrlHint: string
  private readonly log: (line: string) => void

  private tabs = new Map<PageConnection, TabState>()
  private activeTab: TabState | null = null

  /** Canonical registry — the only truth `tools/list` is built from. */
  private commands = new Map<string, WireCommand>()
  private contextKeys = new Set<string>()

  private pendingInvokes = new Map<string, PendingRequest>()
  private pendingContextReads = new Map<string, PendingRequest>()

  private tail: TailEntry[] = []
  private tailSeq = 0

  private listeners = new Set<RegistryListener>()
  private notifyScheduled = false
  private graceTimer: ReturnType<typeof setTimeout> | null = null

  lastRejection: {
    at: number
    reason: string
    page: { bridgeProtocolVersion: number; kernelApiVersion: string }
  } | null = null

  constructor(opts: BridgeOptions = {}) {
    this.invokeTimeoutMs = opts.invokeTimeoutMs ?? 60_000
    this.gracePeriodMs = opts.gracePeriodMs ?? 3_000
    this.tailBufferSize = opts.tailBufferSize ?? 100
    this.pageUrlHint = opts.pageUrlHint ?? 'http://localhost:5173'
    this.log = opts.log ?? (() => {})
  }

  // ── MCP-session fan-out ──────────────────────────────────────────────

  addListener(l: RegistryListener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /** Debounced (microtask-batched) so N-command snapshots emit ONE notification. */
  private scheduleNotify() {
    if (this.notifyScheduled) return
    this.notifyScheduled = true
    setTimeout(() => {
      this.notifyScheduled = false
      for (const l of this.listeners) l.onRegistryChanged()
    }, 20)
  }

  // ── Page channel ─────────────────────────────────────────────────────

  handlePageMessage(conn: PageConnection, msg: PageToBridge): void {
    switch (msg.type) {
      case 'hello': {
        // Decision 6: integer version, exact match or structured rejection.
        if (msg.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
          this.lastRejection = {
            at: Date.now(),
            reason: 'bridge protocol version mismatch — Switchboard was updated; reload this tab',
            page: {
              bridgeProtocolVersion: msg.bridgeProtocolVersion,
              kernelApiVersion: msg.kernelApiVersion,
            },
          }
          this.log(
            `handshake REJECTED: page speaks v${msg.bridgeProtocolVersion}, server speaks v${BRIDGE_PROTOCOL_VERSION}`,
          )
          conn.send({
            type: 'hello-reject',
            reason: 'bridge protocol version mismatch — Switchboard was updated; reload this tab',
            server: {
              bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
              kernelApiVersion: KERNEL_API_VERSION,
            },
            page: {
              bridgeProtocolVersion: msg.bridgeProtocolVersion,
              kernelApiVersion: msg.kernelApiVersion,
            },
          })
          return
        }
        const tab: TabState = {
          tabId: randomUUID(), // decision 11: stable tab id from day one
          kernelApiVersion: msg.kernelApiVersion, // diagnostics only
          connectedAt: Date.now(),
          focusedAt: Date.now(),
          conn,
          snapshot: { commands: [], contextKeys: [] },
        }
        this.tabs.set(conn, tab)
        this.activeTab = tab // fallback rule: most recently connected
        if (this.graceTimer) {
          // Decision 12: reload reconnected inside the grace period — no churn.
          clearTimeout(this.graceTimer)
          this.graceTimer = null
          this.log(`page reconnected within grace period (tab ${tab.tabId}) — no agent-visible churn`)
        }
        this.log(`page connected: tab ${tab.tabId}, kernel API ${msg.kernelApiVersion}`)
        conn.send({ type: 'hello-ok', tabId: tab.tabId, bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION })
        return
      }
      case 'snapshot': {
        const tab = this.tabs.get(conn)
        if (!tab) return // snapshot before (or after failed) handshake: ignored
        tab.snapshot = { commands: msg.commands, contextKeys: msg.contextKeys }
        if (tab === this.activeTab) this.applyActiveSnapshot()
        return
      }
      case 'focus': {
        const tab = this.tabs.get(conn)
        if (!tab) return
        tab.focusedAt = Date.now()
        if (this.activeTab !== tab) {
          this.log(`active tab switched to ${tab.tabId} (focus)`)
          this.activeTab = tab
          this.applyActiveSnapshot() // legal over-time list change (decision 11)
        }
        return
      }
      case 'invoke-result': {
        const pending = this.pendingInvokes.get(msg.id)
        if (!pending) return // late result after cancel/timeout: ignored
        this.settleInvoke(msg.id, pending, msg.ok ? { ok: true, result: msg.result } : { ok: false, error: msg.error })
        return
      }
      case 'context-value': {
        const pending = this.pendingContextReads.get(msg.id)
        if (!pending) return
        this.pendingContextReads.delete(msg.id)
        if (pending.timer) clearTimeout(pending.timer)
        pending.resolve(msg.ok ? { ok: true, result: msg.value } : { ok: false, error: msg.error })
        return
      }
      case 'event': {
        // Decision 1: the bridge is merely a subscriber keeping notes.
        this.tail.push({ seq: ++this.tailSeq, ts: Date.now(), name: msg.name, pluginId: msg.pluginId, payload: msg.payload })
        if (this.tail.length > this.tailBufferSize) this.tail.shift()
        return
      }
    }
  }

  handlePageDisconnect(conn: PageConnection): void {
    const tab = this.tabs.get(conn)
    if (!tab) return
    this.tabs.delete(conn)
    this.log(`page disconnected: tab ${tab.tabId}`)
    // Decision 9: in-flight invokes fail immediately, outcome unknown.
    for (const [id, pending] of [...this.pendingInvokes]) {
      this.settleInvoke(id, pending, {
        ok: false,
        error: 'page disconnected during invocation; outcome unknown',
      })
    }
    for (const [id, pending] of [...this.pendingContextReads]) {
      this.pendingContextReads.delete(id)
      if (pending.timer) clearTimeout(pending.timer)
      pending.resolve({ ok: false, error: 'page disconnected during context read' })
    }
    if (tab === this.activeTab) {
      const remaining = [...this.tabs.values()].sort((a, b) => b.focusedAt - a.focusedAt)
      this.activeTab = remaining[0] ?? null
      if (this.activeTab) {
        this.applyActiveSnapshot()
      } else {
        // Decision 12: grace period before the list tells the (shrunken) truth.
        if (this.graceTimer) clearTimeout(this.graceTimer)
        this.graceTimer = setTimeout(() => {
          this.graceTimer = null
          if (this.tabs.size === 0) {
            this.log(`grace period (${this.gracePeriodMs}ms) expired — page commands leave the tool list`)
            this.setRegistry([], [])
          }
        }, this.gracePeriodMs)
      }
    }
  }

  private applyActiveSnapshot() {
    const snap = this.activeTab?.snapshot ?? { commands: [], contextKeys: [] }
    this.setRegistry(snap.commands, snap.contextKeys)
  }

  /** Diff-then-notify: only a real delta reaches the agent surface (decision 7). */
  private setRegistry(commands: WireCommand[], contextKeys: string[]) {
    const next = new Map(commands.map((c) => [c.id, c]))
    const changed =
      next.size !== this.commands.size ||
      [...next.entries()].some(([id, c]) => JSON.stringify(this.commands.get(id)) !== JSON.stringify(c))
    this.contextKeys = new Set(contextKeys)
    if (!changed) return
    this.commands = next
    this.log(`registry changed: ${next.size} command(s) → notifying ${this.listeners.size} agent session(s)`)
    this.scheduleNotify()
  }

  // ── Agent-facing queries ─────────────────────────────────────────────

  listCommands(): WireCommand[] {
    return [...this.commands.values()]
  }

  hasCommand(id: string): boolean {
    return this.commands.has(id)
  }

  status() {
    return {
      bridge: {
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
        kernelApiVersion: KERNEL_API_VERSION,
        invokeTimeoutMs: this.invokeTimeoutMs,
        gracePeriodMs: this.gracePeriodMs,
      },
      page: {
        connected: this.tabs.size > 0,
        activeTabId: this.activeTab?.tabId ?? null,
        tabs: [...this.tabs.values()].map((t) => ({
          tabId: t.tabId,
          kernelApiVersion: t.kernelApiVersion,
          connectedAt: t.connectedAt,
          focusedAt: t.focusedAt,
          commands: t.snapshot.commands.length,
        })),
      },
      registry: { commands: this.commands.size, contextKeys: [...this.contextKeys] },
      events: { buffered: this.tail.length, bufferSize: this.tailBufferSize },
      lastHandshakeRejection: this.lastRejection,
      agentSessions: this.listeners.size,
      hint: this.tabs.size === 0 ? `no page connected — open ${this.pageUrlHint}` : undefined,
    }
  }

  tailEvents(limit = 20): TailEntry[] {
    return this.tail.slice(-limit)
  }

  async readContext(key: string): Promise<InvokeOutcome> {
    const active = this.activeTab
    if (!active) {
      return { ok: false, error: `no page connected — open ${this.pageUrlHint} to read context` }
    }
    // Decision 8: live round-trip, no bridge-side cache, always fresh.
    const id = randomUUID()
    return new Promise<InvokeOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingContextReads.delete(id)
        resolve({ ok: false, error: `context read '${key}' timed out after ${this.invokeTimeoutMs}ms` })
      }, this.invokeTimeoutMs)
      this.pendingContextReads.set(id, { resolve, timer })
      active.conn.send({ type: 'context-read', id, key })
    })
  }

  async invoke(command: string, input: unknown, signal?: AbortSignal): Promise<InvokeOutcome> {
    const active = this.activeTab
    if (!active) {
      // Decision 4/12: actionable isError, never "unknown tool".
      return {
        ok: false,
        error: `cannot invoke '${command}': no page connected — open ${this.pageUrlHint} and retry`,
      }
    }
    if (!this.commands.has(command)) {
      return {
        ok: false,
        error: `unknown command '${command}' — it is not in the connected page's registry (check switchboard.status)`,
      }
    }
    const id = randomUUID()
    return new Promise<InvokeOutcome>((resolve) => {
      const pending: PendingRequest = { resolve, signal }
      // Decision 10: timeout expiry fires the cancel path, names command & limit.
      pending.timer = setTimeout(() => {
        active.conn.send({ type: 'cancel', id })
        this.settleInvoke(id, pending, {
          ok: false,
          error: `command '${command}' timed out after ${this.invokeTimeoutMs}ms; a cancel was sent to the page`,
        })
      }, this.invokeTimeoutMs)
      if (signal) {
        // Decision 9: agent cancel → wire cancel → kernel AbortSignal.
        pending.onAbort = () => {
          this.log(`agent cancelled invocation ${id} (${command}) — forwarding wire cancel`)
          active.conn.send({ type: 'cancel', id })
          this.settleInvoke(id, pending, { ok: false, error: `invocation of '${command}' cancelled by agent` })
        }
        if (signal.aborted) pending.onAbort()
        else signal.addEventListener('abort', pending.onAbort, { once: true })
      }
      this.pendingInvokes.set(id, pending)
      active.conn.send({ type: 'invoke', id, command, input })
    })
  }

  private settleInvoke(id: string, pending: PendingRequest, outcome: InvokeOutcome) {
    if (!this.pendingInvokes.has(id)) return
    this.pendingInvokes.delete(id)
    if (pending.timer) clearTimeout(pending.timer)
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
    pending.resolve(outcome)
  }
}
