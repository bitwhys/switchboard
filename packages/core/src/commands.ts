// Kernel spec §6 — Commands: named, invocable operations, the unit
// agents invoke as MCP tools. Registration is exclusive (§2.2);
// dispatch runs `validate` pre-dispatch (§6.3) and wraps handler
// failures with the command id (§6.1). Schemas and annotations are
// carried verbatim — the kernel depends on no schema library (§6.2)
// and never deep-inspects payloads (§14).

import type { DiagnosticsHub } from "./diagnostics";
import type { Disposable } from "./disposable";
import { guardName, guardReservedWrite, loud } from "./guards";

/** Kernel spec §11.1 — the read-only, tracked-read Context view. */
export interface ContextView {
	get(key: string): unknown | undefined;
}

/** Kernel spec §6.3 — a Standard-Schema-shaped pre-dispatch validator. */
export type StandardSchemaValidate = (
	input: unknown,
) =>
	| { value: unknown }
	| { issues: { message: string; path?: (string | number)[] }[] };

/** Kernel spec §6 — who invoked, and the cancellation signal. */
export interface Invocation {
	source: "ui" | "agent" | "plugin" | "host";
	signal: AbortSignal;
}

/** Kernel spec §6 — one command. */
export interface CommandDefinition {
	id: string;
	title: string;
	description?: string;
	inputSchema?: object;
	outputSchema?: object;
	validate?: StandardSchemaValidate;
	annotations?: object;
	/** §11 — visibility predicate; evaluation machinery lands with the §10–§12 slice. */
	when?: (ctx: ContextView) => boolean;
	execute(input: object, invocation: Invocation): unknown | Promise<unknown>;
}

/** Kernel spec §6 — the per-plugin commands surface (observe: §16.1, later slice). */
export interface CommandsApi {
	register(command: CommandDefinition): Disposable;
	execute(id: string, input?: object): Promise<unknown>;
}

export interface CommandRegistry {
	register(owner: string, command: CommandDefinition): Disposable;
	execute(
		source: Invocation["source"],
		actor: string,
		id: string,
		input?: object,
	): Promise<unknown>;
}

interface RegisteredCommand {
	definition: CommandDefinition;
	owner: string;
}

export function createCommandRegistry(hub: DiagnosticsHub): CommandRegistry {
	const commands = new Map<string, RegisteredCommand>();

	return {
		register(owner, command) {
			const id = command?.id;
			guardName(hub, owner, id, "command id");
			guardReservedWrite(hub, owner, id, "registering command");
			// §2.2 / §6.1: command ids are an exclusive kind.
			if (commands.has(id)) {
				throw loud(hub, {
					code: "name-taken",
					source: "kernel",
					plugin: owner,
					subject: id,
					message: `command id ${JSON.stringify(id)} is already registered by ${commands.get(id)?.owner} (§2.2)`,
				});
			}
			commands.set(id, { definition: command, owner });
			return { dispose: () => commands.delete(id) };
		},

		// async so every failure is a rejection at the call site (§2.1 of the
		// diagnostics spec: loud on async surfaces = rejected + emitted).
		async execute(source, actor, id, input) {
			guardName(hub, actor, id, "command id");
			const entry = commands.get(id);
			if (!entry) {
				throw loud(hub, {
					code: "command-not-found",
					source: "kernel",
					plugin: actor !== "host" ? actor : undefined,
					subject: id,
					message: `no command ${JSON.stringify(id)} is registered (§6.1)`,
				});
			}
			let value: object = input ?? {};
			// §6.3: pre-dispatch validation — on issues the kernel MUST NOT
			// run execute and returns the issues as a structured error.
			if (entry.definition.validate) {
				const result = entry.definition.validate(value);
				if ("issues" in result) {
					throw loud(hub, {
						code: "invalid-input",
						source: "kernel",
						plugin: entry.owner,
						subject: id,
						message: `input rejected by ${JSON.stringify(id)}'s validate: ${result.issues.map((i) => i.message).join("; ")} (§6.3)`,
						issues: result.issues,
					});
				}
				value = result.value as object;
			}
			// v1 core has no abort surface; the signal exists for handlers
			// written against the §6 shape and for future callers that abort.
			const controller = new AbortController();
			try {
				return await entry.definition.execute(value, {
					source,
					signal: controller.signal,
				});
			} catch (cause) {
				// §6.1: handler errors become structured invocation errors
				// wrapped with the command id.
				throw loud(hub, {
					code: "command-failed",
					source: "kernel",
					plugin: entry.owner,
					subject: id,
					message: `command ${JSON.stringify(id)} failed: ${cause instanceof Error ? cause.message : String(cause)} (§6.1)`,
					cause,
				});
			}
		},
	};
}
