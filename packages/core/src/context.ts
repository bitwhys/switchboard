// Kernel spec §8 — Context: named, observable values, the home of
// "what is true right now". Whole-value replace, no equality dedup,
// synchronous replay on observe.

import type { DiagnosticsHub } from "./diagnostics";
import type { Disposable } from "./disposable";
import type { EmitMeta, EventCallback } from "./events";
import { guardName, guardReservedWrite } from "./guards";

/** Kernel spec §8 — the per-plugin context surface. */
export interface ContextApi {
	set(key: string, value: unknown): void;
	get(key: string): unknown | undefined;
	delete(key: string): void;
	observe(
		key: string,
		cb: (value: unknown, meta: EmitMeta) => void,
	): Disposable;
}

export interface ContextStore {
	set(owner: string, key: string, value: unknown): void;
	get(owner: string, key: string): unknown | undefined;
	delete(owner: string, key: string): void;
	observe(owner: string, key: string, cb: EventCallback): Disposable;
}

interface Entry {
	present: boolean;
	value: unknown;
	/** Meta of the last write (set or delete); replayed to new observers (§8.1). */
	meta: EmitMeta;
}

export function createContextStore(hub: DiagnosticsHub): ContextStore {
	const entries = new Map<string, Entry>();
	const observers = new Map<string, Set<EventCallback>>();

	function notify(key: string, value: unknown, meta: EmitMeta): void {
		for (const cb of observers.get(key) ?? []) {
			try {
				cb(value, meta);
			} catch {
				// a throwing observer must not break the writer or its peers
			}
		}
	}

	return {
		set(owner, key, value) {
			guardName(hub, owner, key, "context key");
			guardReservedWrite(hub, owner, key, "setting");
			const meta: EmitMeta = { source: owner, timestamp: Date.now() };
			entries.set(key, { present: true, value, meta });
			// §8.3: every set notifies — no equality dedup, ever.
			notify(key, value, meta);
		},
		get(owner, key) {
			guardName(hub, owner, key, "context key");
			const entry = entries.get(key);
			return entry?.present ? entry.value : undefined;
		},
		delete(owner, key) {
			guardName(hub, owner, key, "context key");
			guardReservedWrite(hub, owner, key, "deleting");
			const meta: EmitMeta = { source: owner, timestamp: Date.now() };
			// the key becomes unset but the last-write meta survives for replay
			entries.set(key, { present: false, value: undefined, meta });
			// §8.3: delete notifies observers with undefined.
			notify(key, undefined, meta);
		},
		observe(owner, key, cb) {
			guardName(hub, owner, key, "context key");
			let set = observers.get(key);
			if (!set) {
				set = new Set();
				observers.set(key, set);
			}
			set.add(cb);
			// §8.1: fire synchronously with the current value — undefined
			// included — so the callback is the complete rendering logic.
			const entry = entries.get(key);
			try {
				cb(
					entry?.present ? entry.value : undefined,
					entry?.meta ?? { source: "kernel", timestamp: Date.now() },
				);
			} catch {
				// same containment as live notification
			}
			return { dispose: () => set.delete(cb) };
		},
	};
}
