// Diagnostics spec §8 — the node side. The kernel's channel is page-side
// only; here "loud" means the diagnostic written to stderr as JSON lines
// (one object per line, same shape as §4), plus the process crashing where
// a spec says so (e.g. `port-in-use`).

import type { Diagnostic } from "@switchboard-dev/core";

export type DiagnosticWriter = (d: Diagnostic) => void;

/** The default writer: one JSON object per line on stderr (diagnostics §8). */
export function stderrDiagnosticWriter(d: Diagnostic): void {
	process.stderr.write(`${JSON.stringify(d)}\n`);
}

/**
 * Stamps `source: 'bridge'` and the timestamp (diagnostics §4.1) and hands
 * the entry to the writer. Adapters may substitute the writer to relay the
 * stream; the vocabulary is not theirs to change.
 */
export function createDiagnostics(
	write: DiagnosticWriter = stderrDiagnosticWriter,
) {
	return (d: {
		severity: "error" | "warning";
		code: string;
		plugin?: string;
		subject?: string;
		message: string;
	}): Diagnostic => {
		const entry: Diagnostic = {
			...d,
			source: "bridge",
			timestamp: Date.now(),
		};
		write(entry);
		return entry;
	};
}

export type EmitDiagnostic = ReturnType<typeof createDiagnostics>;
