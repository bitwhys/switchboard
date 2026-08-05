/**
 * Per-agent-session MCP surface.
 *
 * SDK constraint (research §2): one Server instance per MCP connection, so the
 * bridge holds N of these over ONE BridgeCore. We use the low-level `Server`
 * (not `McpServer`) because the page hands us plain JSON Schema over the wire
 * and the low-level tools/list handler can return it verbatim — no Zod round
 * trip. `tools/list` is always rebuilt from the canonical registry, so change
 * notifications stay pure cache-invalidation hints (decision 14).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { BridgeCore } from './core.js'
import { KERNEL_API_VERSION } from '../wire.js'

const ajv = new Ajv2020({ strict: false })

const BUILTINS: Tool[] = [
  {
    name: 'switchboard.status',
    description:
      'Connection, tab, registry, and version truth for the Switchboard bridge. Works whether or not a page is connected.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'switchboard.context.read',
    description:
      'Read the current value of a Switchboard Context key from the live page (always a fresh round-trip, never cached).',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Context key to read' } },
      required: ['key'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'switchboard.events.tail',
    description:
      'Return the most recent Switchboard events from the bridge-side tail buffer (survives page reloads; dies with the dev server).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
]

function ok(structured: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown> | undefined,
  }
}

function err(message: string): CallToolResult {
  // Decision 4: execution failures are isError tool results, not protocol errors.
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function createMcpSession(bridge: BridgeCore): Server {
  const server = new Server(
    { name: 'switchboard-bridge-spike', version: KERNEL_API_VERSION },
    { capabilities: { tools: { listChanged: true } } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const pageTools: Tool[] = bridge.listCommands().map((c) => ({
      name: c.id,
      description: c.description,
      inputSchema: (c.inputSchema ?? { type: 'object' }) as Tool['inputSchema'],
      outputSchema: c.outputSchema as Tool['outputSchema'],
      annotations: c.annotations, // verbatim per kernel decision #5
      _meta: { 'switchboard/pluginId': c.pluginId },
    }))
    return { tools: [...BUILTINS, ...pageTools] }
  })

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args } = req.params
    switch (name) {
      case 'switchboard.status':
        return ok(bridge.status())
      case 'switchboard.events.tail':
        return ok({ events: bridge.tailEvents((args as { limit?: number } | undefined)?.limit ?? 20) })
      case 'switchboard.context.read': {
        const key = (args as { key?: string } | undefined)?.key
        if (typeof key !== 'string') return err('context.read requires a string `key` argument')
        const outcome = await bridge.readContext(key)
        return outcome.ok ? ok({ key, value: outcome.result }) : err(outcome.error)
      }
    }

    const outcome = await bridge.invoke(name, args ?? {}, extra.signal)
    if (!outcome.ok) return err(outcome.error)

    // Decision 3: outputSchema enforced at the bridge edge, before answering.
    const command = bridge.listCommands().find((c) => c.id === name)
    if (command?.outputSchema) {
      const validate = ajv.compile(command.outputSchema)
      if (!validate(outcome.result)) {
        return err(
          `command '${name}' returned a result that does not conform to its declared outputSchema: ` +
            ajv.errorsText(validate.errors),
        )
      }
    }
    return ok(outcome.result)
  })

  return server
}
