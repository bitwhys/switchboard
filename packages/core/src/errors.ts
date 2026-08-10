// Diagnostics spec §3 — named errors. Conformance matches on `code`;
// `message` is free-form human prose and may change without notice.

export interface SwitchboardErrorInit {
	code: string;
	source: string;
	plugin?: string;
	subject?: string;
	message: string;
	/** §6.3: `validate` issues ride the `invalid-input` error to the caller. */
	issues?: ValidationIssue[];
	/** §6.1: the handler's own error rides the `command-failed` wrapper. */
	cause?: unknown;
}

/** Kernel spec §6.3 — one Standard-Schema-shaped validation issue. */
export interface ValidationIssue {
	message: string;
	path?: (string | number)[];
}

export class SwitchboardError extends Error {
	override readonly name = "SwitchboardError";
	readonly code: string;
	readonly source: string;
	readonly plugin?: string;
	readonly subject?: string;
	readonly issues?: ValidationIssue[];

	constructor(init: SwitchboardErrorInit) {
		super(init.message, init.cause !== undefined ? { cause: init.cause } : {});
		this.code = init.code;
		this.source = init.source;
		this.plugin = init.plugin;
		this.subject = init.subject;
		this.issues = init.issues;
	}
}
