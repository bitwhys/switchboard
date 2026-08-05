/**
 * Page kernel registry stub.
 *
 * Stands in for `core` + the page half of the bridge: announces a registry
 * snapshot after the handshake, executes invokes (with AbortSignal), answers
 * live context reads, pushes events, and sends focus notifications.
 * Rides Vite's HMR channel via import.meta.hot — send-buffering and reconnect
 * signaling included (research §5.6).
 */
import {
  BRIDGE_PROTOCOL_VERSION,
  KERNEL_API_VERSION,
  WIRE_EVENT,
  type BridgeToPage,
  type PageToBridge,
  type WireCommand,
} from '../wire.js'

const hot = import.meta.hot
const logEl = document.getElementById('log')!
const connEl = document.getElementById('conn')!
const tabEl = document.getElementById('tabid')!
const counterEl = document.getElementById('counter')!

function log(line: string) {
  logEl.textContent += `${new Date().toISOString().slice(11, 23)}  ${line}\n`
  logEl.scrollTop = logEl.scrollHeight
  console.log(`[switchboard-stub] ${line}`)
}

if (!hot) {
  log('import.meta.hot unavailable — run under the Vite dev server')
  throw new Error('no HMR channel')
}

function send(msg: PageToBridge) {
  hot!.send(WIRE_EVENT, msg)
}

// ── Stub state ─────────────────────────────────────────────────────────

let counter = 0
const contexts: Record<string, () => unknown> = {
  'demo.counter': () => counter,
  'demo.page-title': () => document.title,
}

type Handler = (input: any, signal: AbortSignal) => Promise<unknown>

const commands = new Map<string, { descriptor: WireCommand; handler: Handler }>()

function register(descriptor: WireCommand, handler: Handler) {
  commands.set(descriptor.id, { descriptor, handler })
}

register(
  {
    id: 'demo.echo',
    pluginId: 'spike.demo',
    description: 'Echo a message back with a timestamp (conforms to its outputSchema).',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { echoed: { type: 'string' }, ts: { type: 'number' } },
      required: ['echoed', 'ts'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (input: { message: string }) => {
    log(`invoke demo.echo("${input.message}")`)
    return { echoed: input.message, ts: Date.now() }
  },
)

register(
  {
    id: 'demo.bad-output',
    pluginId: 'spike.demo',
    description: 'Deliberately violates its declared outputSchema — bridge must answer isError.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    log('invoke demo.bad-output (returning nonconforming result)')
    return { count: 'not-a-number', extra: true }
  },
)

register(
  {
    id: 'demo.throws',
    pluginId: 'spike.demo',
    description: 'Handler throws — bridge must surface an isError tool result.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    log('invoke demo.throws (throwing)')
    throw new Error('demo.throws exploded on purpose')
  },
)

register(
  {
    id: 'demo.slow',
    pluginId: 'spike.demo',
    description: 'Sleeps 30s unless aborted; proves cancel → AbortSignal pass-through.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  (_input, signal) =>
    new Promise((resolve, reject) => {
      log('invoke demo.slow (30s sleep, abortable)')
      const timer = setTimeout(() => resolve({ slept: true }), 30_000)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        log('demo.slow ABORTED via AbortSignal — emitting demo.aborted event')
        send({ type: 'event', name: 'demo.aborted', pluginId: 'spike.demo', payload: { at: Date.now() } })
        reject(new Error('aborted by AbortSignal'))
      })
    }),
)

function snapshot() {
  send({
    type: 'snapshot',
    commands: [...commands.values()].map((c) => c.descriptor),
    contextKeys: Object.keys(contexts),
  })
}

// ── Wire protocol client ───────────────────────────────────────────────

const inflight = new Map<string, AbortController>()
const versionOverride = new URLSearchParams(location.search).get('v')
const helloVersion = versionOverride ? Number(versionOverride) : BRIDGE_PROTOCOL_VERSION

let helloSent = false
function hello() {
  if (helloSent) return
  helloSent = true
  log(`→ hello (BRIDGE_PROTOCOL_VERSION=${helloVersion}, KERNEL_API_VERSION=${KERNEL_API_VERSION})`)
  send({ type: 'hello', bridgeProtocolVersion: helloVersion, kernelApiVersion: KERNEL_API_VERSION })
}

hot.on(WIRE_EVENT, async (msg: BridgeToPage) => {
  switch (msg.type) {
    case 'hello-ok': {
      connEl.textContent = `connected (wire v${msg.bridgeProtocolVersion})`
      connEl.className = 'badge ok'
      tabEl.textContent = msg.tabId
      log(`← hello-ok: tab ${msg.tabId} — announcing registry snapshot (${commands.size} commands)`)
      snapshot()
      return
    }
    case 'hello-reject': {
      connEl.textContent = 'REJECTED — Switchboard was updated; reload this tab'
      connEl.className = 'badge bad'
      log(`← hello-reject: ${msg.reason} (server v${msg.server.bridgeProtocolVersion}, page v${msg.page.bridgeProtocolVersion})`)
      return
    }
    case 'invoke': {
      const entry = commands.get(msg.command)
      if (!entry) {
        send({ type: 'invoke-result', id: msg.id, ok: false, error: `page has no command '${msg.command}'` })
        return
      }
      const controller = new AbortController()
      inflight.set(msg.id, controller)
      // SPIKE FINDING: must run DETACHED. Vite's HMR client processes incoming
      // messages sequentially, so awaiting a long handler inside this listener
      // blocks the entire wire pump — including the cancel for this very invoke.
      void (async () => {
        try {
          const result = await entry.handler(msg.input, controller.signal)
          send({ type: 'invoke-result', id: msg.id, ok: true, result })
        } catch (e) {
          send({ type: 'invoke-result', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
        } finally {
          inflight.delete(msg.id)
        }
      })()
      return
    }
    case 'cancel': {
      log(`← cancel for invocation ${msg.id.slice(0, 8)}…`)
      inflight.get(msg.id)?.abort()
      return
    }
    case 'context-read': {
      const reader = contexts[msg.key]
      log(`← context-read '${msg.key}' (live round-trip)`)
      if (!reader) {
        send({ type: 'context-value', id: msg.id, ok: false, error: `unknown context key '${msg.key}'` })
      } else {
        send({ type: 'context-value', id: msg.id, ok: true, value: reader() })
      }
      return
    }
  }
})

// Reconnect signaling comes free with the HMR channel.
hot.on('vite:ws:connect', () => {
  log('HMR channel connected — sending hello')
  hello()
})
hot.on('vite:ws:disconnect', () => {
  helloSent = false
  connEl.textContent = 'disconnected'
  connEl.className = 'badge pending'
  log('HMR channel disconnected')
})

// Decision 11: lightweight focus notification drives the active-tab model.
window.addEventListener('focus', () => send({ type: 'focus' }))

// Demo interactions
document.getElementById('inc')!.addEventListener('click', () => {
  counter += 1
  counterEl.textContent = String(counter)
})
document.getElementById('emit')!.addEventListener('click', () => {
  log('→ event demo.ping')
  send({ type: 'event', name: 'demo.ping', pluginId: 'spike.demo', payload: { counter } })
})

// A periodic heartbeat event to populate the tail buffer.
setInterval(() => {
  send({ type: 'event', name: 'demo.tick', pluginId: 'spike.demo', payload: { counter } })
}, 5_000)

hello()
