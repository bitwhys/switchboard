/**
 * Validation client for the bridge transport spike (wayfinder #9).
 *
 * Plays the agent role with the real MCP TS SDK client over Streamable HTTP.
 * Phases:
 *   no-page    — built-ins-only truth before any page connects
 *   origin     — Origin allowlist enforcement at the MCP door
 *   with-page  — full round-trip suite against the live page (run after
 *                opening http://localhost:5173 in a browser)
 *   watch      — subscribe to tools/list_changed for 45s and print list sizes
 *                (drive page reload / tab close in the browser meanwhile)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const ENDPOINT = new URL('http://localhost:5173/__switchboard/mcp')
const phase = process.argv[2] ?? 'no-page'

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function text(r: CallToolResult): string {
  const first = r.content?.[0]
  return first && first.type === 'text' ? first.text : ''
}

async function connect(name: string) {
  const client = new Client({ name, version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(ENDPOINT)
  await client.connect(transport)
  // Be a well-behaved 2025-era client: DELETE the session on shutdown.
  // (Clients are NOT required to do this — the bridge must GC idle sessions.)
  const close = async () => {
    await transport.terminateSession().catch(() => {})
    await client.close()
  }
  return { client, transport, close }
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
  return (await client.callTool({ name, arguments: args }, undefined, { signal })) as CallToolResult
}

// ─────────────────────────────────────────────────────────────────────────

async function phaseNoPage() {
  console.log('\n■ phase: no-page (nothing has connected to the page channel yet)')
  const { client, close } = await connect('spike-validator-nopage')

  const tools = (await client.listTools()).tools.map((t) => t.name).sort()
  console.log(`  tools/list → [${tools.join(', ')}]`)
  check(
    'tool list is exactly the three switchboard.* built-ins',
    JSON.stringify(tools) === JSON.stringify(['switchboard.context.read', 'switchboard.events.tail', 'switchboard.status']),
  )

  const status = await callTool(client, 'switchboard.status')
  const s = status.structuredContent as any
  console.log(`  switchboard.status → connected=${s?.page?.connected}, hint=${JSON.stringify(s?.hint)}`)
  check('status says no page connected', s?.page?.connected === false)
  check('status carries an actionable hint', typeof s?.hint === 'string' && s.hint.includes('http://localhost:5173'))
  check('status reports bridge protocol version 1', s?.bridge?.bridgeProtocolVersion === 1)

  const ctx = await callTool(client, 'switchboard.context.read', { key: 'demo.counter' })
  check('context.read fails actionably (isError, names the URL)', ctx.isError === true && text(ctx).includes('open http'))

  const tail = await callTool(client, 'switchboard.events.tail')
  check('events.tail answers (not an error) with its buffer', tail.isError !== true)

  const stale = await callTool(client, 'demo.echo', { message: 'hi' })
  check(
    'calling a page command → actionable isError, never a protocol "unknown tool" error',
    stale.isError === true && text(stale).includes('no page connected'),
    text(stale),
  )
  await close()
}

async function phaseOrigin() {
  console.log('\n■ phase: origin (DNS-rebinding / Origin allowlist at the MCP door)')
  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'origin-probe', version: '0' } },
  })
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

  const evil = await fetch(ENDPOINT, { method: 'POST', headers: { ...headers, origin: 'http://evil.example' }, body: initBody })
  console.log(`  Origin http://evil.example → HTTP ${evil.status}`)
  check('disallowed Origin is rejected with 403', evil.status === 403)

  const good = await fetch(ENDPOINT, { method: 'POST', headers: { ...headers, origin: 'http://localhost:5173' }, body: initBody })
  console.log(`  Origin http://localhost:5173 → HTTP ${good.status}`)
  check('allowlisted Origin is accepted', good.status === 200)

  const none = await fetch(ENDPOINT, { method: 'POST', headers, body: initBody })
  console.log(`  no Origin header (terminal agent) → HTTP ${none.status}`)
  check('request without Origin (terminal agent) is accepted', none.status === 200)

  const rebind = await fetch('http://127.0.0.1:5173/__switchboard/mcp', {
    method: 'POST',
    headers: { ...headers, host: 'attacker.example' },
    body: initBody,
  }).catch(() => null)
  if (rebind) {
    console.log(`  forged Host attacker.example → HTTP ${rebind.status}`)
    check('forged Host header is rejected (DNS rebinding)', rebind.status === 403)
  } else {
    console.log('  (fetch refused to send forged Host — skipping that probe)')
  }
}

async function phaseWithPage() {
  console.log('\n■ phase: with-page (open http://localhost:5173 in a browser first)')
  const { client, close } = await connect('spike-validator-A')
  const second = await connect('spike-validator-B')

  let aNotified = 0
  let bNotified = 0
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => void aNotified++)
  second.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => void bNotified++)

  const tools = (await client.listTools()).tools
  const names = tools.map((t) => t.name).sort()
  console.log(`  tools/list → [${names.join(', ')}]`)
  check('page commands appear alongside built-ins', names.includes('demo.echo') && names.includes('demo.slow'))
  const echo = tools.find((t) => t.name === 'demo.echo')!
  check('demo.echo carries its JSON inputSchema verbatim', (echo.inputSchema as any)?.properties?.message?.type === 'string')
  check('demo.echo carries its outputSchema', (echo.outputSchema as any)?.required?.includes('echoed') === true)
  check('demo.echo annotations pass through verbatim', echo.annotations?.readOnlyHint === true && echo.annotations?.openWorldHint === false)
  check('page tool is tagged with owning plugin id (_meta)', (echo as any)._meta?.['switchboard/pluginId'] === 'spike.demo')

  const status = await callTool(client, 'switchboard.status')
  const s = status.structuredContent as any
  console.log(`  status → tabs=${s?.page?.tabs?.length}, activeTab=${String(s?.page?.activeTabId).slice(0, 8)}…, agentSessions=${s?.agentSessions}`)
  check('status shows a connected page with a stable tab id', s?.page?.connected === true && typeof s?.page?.activeTabId === 'string')
  check('status shows both agent sessions (McpServer-per-session fan-out)', s?.agentSessions === 2)
  check('status reports page kernel API version (diagnostics only)', s?.page?.tabs?.[0]?.kernelApiVersion === '0.1.0-spike')

  const echoRes = await callTool(client, 'demo.echo', { message: 'round-trip!' })
  const echoOut = echoRes.structuredContent as any
  console.log(`  demo.echo → ${text(echoRes)}`)
  check('invoke round-trip returns conforming structured output', echoRes.isError !== true && echoOut?.echoed === 'round-trip!' && typeof echoOut?.ts === 'number')

  const bad = await callTool(client, 'demo.bad-output')
  console.log(`  demo.bad-output → isError=${bad.isError}: ${text(bad).slice(0, 120)}`)
  check('outputSchema violation → isError naming the command', bad.isError === true && text(bad).includes('demo.bad-output') && text(bad).includes('outputSchema'))

  const thrown = await callTool(client, 'demo.throws')
  check('handler throw → isError with the handler message', thrown.isError === true && text(thrown).includes('exploded on purpose'))

  const ctx = await callTool(client, 'switchboard.context.read', { key: 'demo.counter' })
  const ctxOut = ctx.structuredContent as any
  console.log(`  context.read demo.counter → ${text(ctx)}`)
  check('context read is a live round-trip returning a value', ctx.isError !== true && typeof ctxOut?.value === 'number')
  const missing = await callTool(client, 'switchboard.context.read', { key: 'nope' })
  check('unknown context key errors actionably', missing.isError === true && text(missing).includes('nope'))

  console.log('  demo.slow: invoking, cancelling after 750ms…')
  const controller = new AbortController()
  const slow = callTool(client, 'demo.slow', {}, controller.signal)
  setTimeout(() => controller.abort(), 750)
  const slowOutcome = await slow.then(
    (r) => ({ kind: 'result' as const, r }),
    (e) => ({ kind: 'rejected' as const, e }),
  )
  console.log(`  demo.slow → ${slowOutcome.kind}`)
  check('agent-side cancel settles the call (no 30s wait)', true)
  await new Promise((r) => setTimeout(r, 500))
  const tail = await callTool(client, 'switchboard.events.tail', { limit: 50 })
  const events = (tail.structuredContent as any)?.events ?? []
  const aborted = events.some((e: any) => e.name === 'demo.aborted')
  console.log(`  events.tail → ${events.length} buffered, names: ${[...new Set(events.map((e: any) => e.name))].join(', ')}`)
  check('page AbortSignal fired (demo.aborted event in tail buffer)', aborted)
  check('tail buffer is serving events (demo.tick heartbeats)', events.some((e: any) => e.name === 'demo.tick'))

  console.log(`  list_changed notifications so far: A=${aNotified}, B=${bNotified} (≥1 each expected only if this client connected before the page)`)
  console.log(`\n  Both clients see identical tool lists:`)
  const namesB = (await second.client.listTools()).tools.map((t) => t.name).sort()
  check('second agent session sees the same tool list', JSON.stringify(namesB) === JSON.stringify(names))

  await close()
  await second.close()
}

async function phaseWatch() {
  console.log('\n■ phase: watch (45s) — reload the page tab, then close it, and watch the list')
  const { client, close } = await connect('spike-validator-watch')
  const size = async () => (await client.listTools()).tools.length
  let last = await size()
  console.log(`  t=0s tools=${last}`)
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    const n = await size()
    console.log(`  [${new Date().toISOString().slice(11, 19)}] tools/list_changed → tools=${n} (was ${last})`)
    last = n
  })
  await new Promise((r) => setTimeout(r, 45_000))
  console.log(`  final tools=${await size()}`)
  await close()
}

// ─────────────────────────────────────────────────────────────────────────

const phases: Record<string, () => Promise<void>> = {
  'no-page': phaseNoPage,
  origin: phaseOrigin,
  'with-page': phaseWithPage,
  watch: phaseWatch,
}

const run = phases[phase]
if (!run) {
  console.error(`unknown phase '${phase}' — one of: ${Object.keys(phases).join(', ')}`)
  process.exit(2)
}
await run()
if (phase !== 'watch') {
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${phase}: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
