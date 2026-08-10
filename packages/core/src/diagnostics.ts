// Diagnostics spec — the kernel-owned channel behind "loud" and
// "dev-mode warning". Page-side only; strictly ephemeral (§6).

import type { Disposable } from "./disposable";

export type DiagnosticSeverity = "error" | "warning";

/** Diagnostics spec §4 — one channel entry. */
export interface Diagnostic {
	severity: DiagnosticSeverity;
	code: string;
	source: string;
	plugin?: string;
	subject?: string;
	message: string;
	timestamp: number;
}

/** Diagnostics spec §6.1 — the subscribe-only surface the host sees. */
export interface DiagnosticsChannel {
	subscribe(cb: (d: Diagnostic) => void): Disposable;
}

export interface DiagnosticsHub extends DiagnosticsChannel {
	/** Emit with the timestamp stamped here; `source` is the caller's duty to stamp (§4.1). */
	emit(entry: Omit<Diagnostic, "timestamp">): void;
}

export function createDiagnosticsHub(options: {
	dev: boolean;
	console: boolean;
}): DiagnosticsHub {
	const subscribers = new Set<(d: Diagnostic) => void>();
	// §6.3: the reporter is active iff dev mode is on and console is not false.
	const reporterActive = options.dev && options.console;

	return {
		emit(entry) {
			// §2.2 / §7: warnings are not emitted at all when dev is off.
			if (entry.severity === "warning" && !options.dev) return;
			const d: Diagnostic = { ...entry, timestamp: Date.now() };
			if (reporterActive) {
				const line = `[switchboard] ${d.code} (${d.source}${d.plugin ? ` → ${d.plugin}` : ""}${d.subject ? `: ${d.subject}` : ""})`;
				if (d.severity === "error") console.error(line, d.message);
				else console.warn(line, d.message);
			}
			for (const cb of subscribers) {
				try {
					cb(d);
				} catch {
					// §6: a throwing subscriber must not prevent delivery to the
					// others nor affect the operation the diagnostic reports on.
				}
			}
		},
		subscribe(cb) {
			subscribers.add(cb);
			return { dispose: () => subscribers.delete(cb) };
		},
	};
}
