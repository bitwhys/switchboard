// Shared registration guards. §2.1's one shared validator is applied
// loudly at every name-accepting primitive call; §2.4's reserved
// namespace is enforced on writes (registering, emitting, setting) but
// never on reads or subscriptions — listening to `switchboard.*` must
// stay possible for future kernel events.

import type { DiagnosticsHub } from "./diagnostics";
import { SwitchboardError, type SwitchboardErrorInit } from "./errors";
import { isReservedNamespace, isValidName } from "./names";

/**
 * Diagnostics spec §2.1 — a loud error is the emission AND the named
 * error, always together. Emits the entry, returns the error to throw
 * (or reject with) at the failing call site.
 */
export function loud(
	hub: DiagnosticsHub,
	init: SwitchboardErrorInit,
): SwitchboardError {
	hub.emit({
		severity: "error",
		code: init.code,
		source: init.source,
		plugin: init.plugin,
		subject: init.subject,
		message: init.message,
	});
	return new SwitchboardError(init);
}

/** §2.1: every name entering a primitive API runs the one shared validator. */
export function guardName(
	hub: DiagnosticsHub,
	plugin: string,
	name: unknown,
	kind: string,
): asserts name is string {
	if (!isValidName(name)) {
		throw loud(hub, {
			code: "invalid-name",
			source: "kernel",
			plugin,
			subject: typeof name === "string" ? name : undefined,
			message: `${kind} ${JSON.stringify(name)} violates the name grammar (§2.1)`,
		});
	}
}

/** §2.4: plugin writes under `switchboard.*` are rejected loudly. */
export function guardReservedWrite(
	hub: DiagnosticsHub,
	plugin: string,
	name: string,
	act: string,
): void {
	if (isReservedNamespace(name)) {
		throw loud(hub, {
			code: "reserved-namespace",
			source: "kernel",
			plugin,
			subject: name,
			message: `${act} ${JSON.stringify(name)}: switchboard.* is reserved for the kernel (§2.4)`,
		});
	}
}
