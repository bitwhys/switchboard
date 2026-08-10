// Kernel spec §6 — Commands: named, invocable operations, the unit
// agents invoke as MCP tools. Registration is exclusive (§2.2);
// dispatch runs `validate` pre-dispatch (§6.3) and wraps handler
// failures with the command id (§6.1). Schemas and annotations are
// carried verbatim — the kernel depends on no schema library (§6.2)
// and never deep-inspects payloads (§14). Also home to §11's
// tracked-read `when` evaluation and §16.1's registry observation.

import type { ContextStore } from "./context";
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
	/** §11 — visibility predicate: gates listing, never dispatch (§11.2). */
	when?: (ctx: ContextView) => boolean;
	execute(input: object, invocation: Invocation): unknown | Promise<unknown>;
}

/** Kernel spec §16.1 — one command as observers see it: data fields only. */
export interface CommandRecord {
	id: string;
	title: string;
	description?: string;
	/** Carried verbatim (§6.2). */
	inputSchema?: object;
	outputSchema?: object;
	/** Carried verbatim (§6.4). */
	annotations?: object;
	/** Owning plugin id (`host` for instance-door registrations, §18.2). */
	pluginId: string;
	/** Current `when` state (§11): false = when-hidden. */
	listed: boolean;
}

/** Kernel spec §6 — the per-plugin commands surface. */
export interface CommandsApi {
	register(command: CommandDefinition): Disposable;
	execute(id: string, input?: object): Promise<unknown>;
	/** §16.1 — full-array snapshots, synchronous replay on subscribe. */
	observe(cb: (commands: CommandRecord[]) => void): Disposable;
}

export interface CommandRegistry {
	register(owner: string, command: CommandDefinition): Disposable;
	execute(
		source: Invocation["source"],
		actor: string,
		id: string,
		input?: object,
	): Promise<unknown>;
	observe(cb: (commands: CommandRecord[]) => void): Disposable;
}

interface RegisteredCommand {
	definition: CommandDefinition;
	owner: string;
	/** §11 — current `when` state; when-less commands are always listed. */
	listed: boolean;
	/** §11.1 — the keys the last evaluation actually read; re-tracked every run. */
	deps: Set<string>;
}

export function createCommandRegistry(
	hub: DiagnosticsHub,
	context: ContextStore,
): CommandRegistry {
	const commands = new Map<string, RegisteredCommand>();
	const observers = new Set<(records: CommandRecord[]) => void>();

	// §16.1: snapshots, never deltas — a fresh full array in registration
	// order; schemas and annotations ride verbatim, behavior never does.
	function snapshot(): CommandRecord[] {
		return [...commands.values()].map((entry) => ({
			id: entry.definition.id,
			title: entry.definition.title,
			description: entry.definition.description,
			inputSchema: entry.definition.inputSchema,
			outputSchema: entry.definition.outputSchema,
			annotations: entry.definition.annotations,
			pluginId: entry.owner,
			listed: entry.listed,
		}));
	}

	function fire(): void {
		if (observers.size === 0) return;
		const records = snapshot();
		for (const cb of [...observers]) {
			try {
				cb(records);
			} catch {
				// same containment as context.observe (§8.1's replay posture)
			}
		}
	}

	// §11.1: run the predicate over a tracked-read view — the keys it
	// actually reads become its dependency set, re-tracked on every run.
	// A throwing predicate violates §11.1's purity MUST: contained, the
	// evaluation counts as false, and a dev-mode warning (`when-failed`)
	// says so.
	function evaluate(entry: RegisteredCommand): boolean {
		const when = entry.definition.when;
		if (!when) return true;
		const reads = new Set<string>();
		const view: ContextView = {
			get(key) {
				reads.add(key);
				return context.peek(key);
			},
		};
		try {
			return when(view) === true;
		} catch (cause) {
			hub.emit({
				severity: "warning",
				code: "when-failed",
				source: "kernel",
				plugin: entry.owner,
				subject: entry.definition.id,
				message: `\`when\` for ${JSON.stringify(entry.definition.id)} threw (${cause instanceof Error ? cause.message : String(cause)}) — predicates must be pure; treating as not listed (§11.1)`,
			});
			return false;
		} finally {
			entry.deps = reads;
		}
	}

	// §11.1: re-evaluate only commands whose last run actually read the
	// changed key; §16.1: observers fire iff a re-evaluation flips `listed`.
	context.onChange((key) => {
		let flipped = false;
		for (const entry of commands.values()) {
			if (!entry.definition.when || !entry.deps.has(key)) continue;
			const listed = evaluate(entry);
			if (listed !== entry.listed) {
				entry.listed = listed;
				flipped = true;
			}
		}
		if (flipped) fire();
	});

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
			const entry: RegisteredCommand = {
				definition: command,
				owner,
				listed: true,
				deps: new Set(),
			};
			// §11: the initial `when` evaluation happens at registration, so
			// the record enters the feed with its real `listed` state.
			entry.listed = evaluate(entry);
			commands.set(id, entry);
			fire();
			return {
				dispose: () => {
					if (commands.delete(id)) fire();
				},
			};
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

		// §16.1: synchronous replay of the complete current array, then a
		// fresh full array on every registration, disposal, and when flip.
		observe(cb) {
			observers.add(cb);
			try {
				cb(snapshot());
			} catch {
				// same containment as live notification
			}
			return { dispose: () => observers.delete(cb) };
		},
	};
}
