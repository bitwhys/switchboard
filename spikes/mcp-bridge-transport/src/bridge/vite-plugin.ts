/**
 * adapter-vite (spike edition).
 *
 * - Agent edge: Streamable HTTP mounted at /__switchboard/mcp on the dev
 *   server's own HTTP server (stateful: Mcp-Session-Id + GET SSE stream, so
 *   2025-era clients receive notifications/tools/list_changed). Decision 13:
 *   SDK DNS-rebinding protection ON with allowlisted dev origins.
 * - Page edge: Switchboard wire protocol as `switchboard:msg` typed custom
 *   events on Vite's own HMR WebSocket (inherits Vite's post-CVE token
 *   handshake; buffering & reconnect signaling for free).
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, WebSocketClient } from 'vite'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { BridgeCore, type PageConnection } from './core.js'
import { createMcpSession } from './mcp-session.js'
import { WIRE_EVENT, type PageToBridge } from '../wire.js'

const MCP_PATH = '/__switchboard/mcp'

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length ? JSON.parse(raw) : undefined
}

export function switchboardBridge(): Plugin {
  return {
    name: 'switchboard:bridge-spike',
    configureServer(server) {
      const port = server.config.server.port ?? 5173
      const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
      const log = (line: string) => server.config.logger.info(`[switchboard] ${line}`)

      const bridge = new BridgeCore({ pageUrlHint: origins[0], log })

      // ── Page channel: Vite HMR WS ────────────────────────────────────
      const conns = new Map<WebSocketClient, PageConnection>()
      server.ws.on(WIRE_EVENT, (data: PageToBridge, client: WebSocketClient) => {
        let conn = conns.get(client)
        if (!conn) {
          conn = { send: (msg) => client.send(WIRE_EVENT, msg) }
          conns.set(client, conn)
          client.socket.on('close', () => {
            conns.delete(client)
            bridge.handlePageDisconnect(conn!)
          })
        }
        bridge.handlePageMessage(conn, data)
      })

      // ── Agent edge: Streamable HTTP ──────────────────────────────────
      const transports = new Map<string, StreamableHTTPServerTransport>()

      server.middlewares.use(MCP_PATH, (req, res) => {
        void handleMcp(req, res).catch((e) => {
          log(`MCP handler error: ${e}`)
          if (!res.headersSent) {
            res.statusCode = 500
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }))
          }
        })
      })

      async function handleMcp(req: IncomingMessage, res: ServerResponse) {
        const sessionId = req.headers['mcp-session-id'] as string | undefined
        const body = req.method === 'POST' ? await readBody(req) : undefined

        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res, body)
          return
        }

        if (req.method === 'POST' && isInitializeRequest(body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            enableDnsRebindingProtection: true,
            allowedOrigins: origins,
            allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`],
            onsessioninitialized: (sid) => {
              transports.set(sid, transport)
              log(`agent session ${sid.slice(0, 8)}… connected (${transports.size} total)`)
            },
          })
          const session = createMcpSession(bridge)
          // Fan-out membership: registry changes → this session's list_changed.
          const unsubscribe = bridge.addListener({
            onRegistryChanged: () => void session.sendToolListChanged(),
          })
          transport.onclose = () => {
            unsubscribe()
            if (transport.sessionId) {
              transports.delete(transport.sessionId)
              log(`agent session ${transport.sessionId.slice(0, 8)}… closed (${transports.size} total)`)
            }
          }
          await session.connect(transport)
          await transport.handleRequest(req, res, body)
          return
        }

        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: no valid session. POST an initialize request first.' },
            id: null,
          }),
        )
      }

      log(`MCP endpoint mounted at ${origins[0]}${MCP_PATH} (Origin allowlist ON: ${origins.join(', ')})`)
    },
  }
}
