// The agent edge, per agent session (bridge spec §10–§11). One low-level SDK
// `Server` per MCP session, all projecting the ONE canonical registry: the
// page hands the bridge plain JSON Schema, and the low-level tools/list
// handler returns it verbatim — no Zod round trip (§10.1, spike finding 3).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
	ListToolsRequestSchema,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Bridge } from "./core";

const ajv = new Ajv2020({ strict: false });

/** §11 — always registered; work or fail actionably with or without a page. */
const BUILTINS: Tool[] = [
	{
		name: "switchboard.status",
		description:
			"Connection, tab, registry, and version truth for the Switchboard bridge. Works whether or not a page is connected.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "switchboard.context.read",
		description:
			"Read the current value of a Switchboard Context key from the live page (always a fresh round-trip, never cached).",
		inputSchema: {
			type: "object",
			properties: {
				key: { type: "string", description: "Context key to read" },
			},
			required: ["key"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "switchboard.events.tail",
		description:
			"Return recent Switchboard events from the bridge-side tail buffer, newest last (survives page reloads; dies with the dev server).",
		inputSchema: {
			type: "object",
			properties: {
				limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
				since: {
					type: "integer",
					minimum: 0,
					description: "Only entries with a sequence number greater than this",
				},
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
];

function ok(structured: unknown): CallToolResult {
	const isObject =
		typeof structured === "object" &&
		structured !== null &&
		!Array.isArray(structured);
	return {
		content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
		structuredContent: isObject
			? (structured as Record<string, unknown>)
			: undefined,
	};
}

function err(message: string): CallToolResult {
	// §10.5 — everything a working agent can encounter is an isError result.
	return { content: [{ type: "text", text: message }], isError: true };
}

export function createMcpSession(bridge: Bridge): Server {
	const server = new Server(
		{ name: "switchboard-bridge", version: bridge.kernelApiVersion },
		{ capabilities: { tools: { listChanged: true } } },
	);

	// §10.1 — rebuilt from the canonical registry on EVERY call; schemas and
	// annotations verbatim; §10.3 — attribution via _meta, closed-world default.
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		const pageTools: Tool[] = bridge.listCommands().map((c) => {
			const annotations = (c.annotations ?? {}) as Tool["annotations"] & object;
			return {
				name: c.id,
				title: c.title,
				description: c.description,
				inputSchema: (c.inputSchema ?? {
					type: "object",
				}) as Tool["inputSchema"],
				outputSchema: c.outputSchema as Tool["outputSchema"],
				annotations:
					"openWorldHint" in annotations
						? annotations
						: { ...annotations, openWorldHint: false },
				_meta: { "switchboard/pluginId": c.pluginId },
			};
		});
		return { tools: [...BUILTINS, ...pageTools] };
	});

	server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
		const { name, arguments: args } = req.params;
		switch (name) {
			case "switchboard.status":
				return ok(bridge.status());
			case "switchboard.events.tail": {
				const a = (args ?? {}) as { limit?: number; since?: number };
				return ok({ events: bridge.tailEvents(a.limit ?? 20, a.since) });
			}
			case "switchboard.context.read": {
				const key = (args as { key?: unknown } | undefined)?.key;
				if (typeof key !== "string")
					return err(
						"switchboard.context.read requires a string `key` argument",
					);
				const outcome = await bridge.readContext(key);
				return outcome.ok
					? ok({ key, value: outcome.value, pluginId: outcome.pluginId })
					: err(`context key '${key}': ${outcome.error}`);
			}
		}

		const outcome = await bridge.invoke(
			name,
			(args ?? {}) as object,
			extra.signal,
		);
		if (!outcome.ok) return err(outcome.error);

		// §10.4 — declaring outputSchema is a conformance promise; this edge
		// is its enforcement point, and the failure names the command.
		const command = bridge.listCommands().find((c) => c.id === name);
		if (command?.outputSchema) {
			const validate = ajv.compile(command.outputSchema);
			if (!validate(outcome.value)) {
				return err(
					`command '${name}' returned a result that does not conform to its declared outputSchema: ${ajv.errorsText(validate.errors)}`,
				);
			}
		}
		return ok(outcome.value);
	});

	return server;
}
