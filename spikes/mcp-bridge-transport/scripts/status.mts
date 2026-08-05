/** Print switchboard.status as seen by a fresh MCP client. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const client = new Client({ name: 'status-probe', version: '0.0.0' })
const transport = new StreamableHTTPClientTransport(new URL('http://localhost:5173/__switchboard/mcp'))
await client.connect(transport)
const res = await client.callTool({ name: 'switchboard.status', arguments: {} })
console.log((res as any).content?.[0]?.text)
await transport.terminateSession().catch(() => {})
await client.close()
