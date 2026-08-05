/** Print the most recent Switchboard events via switchboard.events.tail. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const client = new Client({ name: 'tail-probe', version: '0.0.0' })
const transport = new StreamableHTTPClientTransport(new URL('http://localhost:5173/__switchboard/mcp'))
await client.connect(transport)
const res = (await client.callTool({ name: 'switchboard.events.tail', arguments: { limit: 12 } })) as any
for (const e of res.structuredContent.events) {
  console.log(new Date(e.ts).toISOString().slice(11, 19), e.name, JSON.stringify(e.payload))
}
await transport.terminateSession().catch(() => {})
await client.close()
