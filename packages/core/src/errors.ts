// Diagnostics spec §3 — named errors. Conformance matches on `code`;
// `message` is free-form human prose and may change without notice.

export interface SwitchboardErrorInit {
	code: string;
	source: string;
	plugin?: string;
	subject?: string;
	message: string;
}

export class SwitchboardError extends Error {
	override readonly name = "SwitchboardError";
	readonly code: string;
	readonly source: string;
	readonly plugin?: string;
	readonly subject?: string;

	constructor(init: SwitchboardErrorInit) {
		super(init.message);
		this.code = init.code;
		this.source = init.source;
		this.plugin = init.plugin;
		this.subject = init.subject;
	}
}
