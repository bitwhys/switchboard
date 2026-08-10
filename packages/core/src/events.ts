// Kernel spec §7 — Events: named, fire-and-forget announcements.
// Strictly ephemeral: no replay, no buffering, ever (§7); replay's one
// home is Context (§8). No wildcard subscriptions in v1.

import type { DiagnosticsHub } from "./diagnostics";
import type { Disposable } from "./disposable";
import { guardName, guardReservedWrite } from "./guards";

/** Kernel spec §7 — who emitted, stamped by the kernel. */
export interface EmitMeta {
	/** Emitting plugin id, or `host` for acts through the kernel instance (§18.2). */
	source: string;
	timestamp: number;
}

export type EventCallback = (payload: unknown, meta: EmitMeta) => void;

/** Kernel spec §7 — the per-plugin events surface. */
export interface EventsApi {
	emit(name: string, payload?: unknown): void;
	on(name: string, cb: EventCallback): Disposable;
}

export interface EventBus {
	/** `owner` is the acting party: a plugin id, or `host` (§18.2, later slice). */
	emit(owner: string, name: string, payload: unknown): void;
	on(owner: string, name: string, cb: EventCallback): Disposable;
}

export function createEventBus(hub: DiagnosticsHub): EventBus {
	const listeners = new Map<string, Set<EventCallback>>();

	return {
		emit(owner, name, payload) {
			guardName(hub, owner, name, "event name");
			// §2.4: a plugin may not speak under the kernel's namespace.
			guardReservedWrite(hub, owner, name, "emitting");
			const meta: EmitMeta = { source: owner, timestamp: Date.now() };
			for (const cb of listeners.get(name) ?? []) {
				try {
					cb(payload, meta);
				} catch {
					// a throwing listener must not break the emitter or its peers
				}
			}
		},
		on(owner, name, cb) {
			// §4.3: `on` is a registration call — grammar-checked; subscribing
			// under switchboard.* stays legal (observation is not a claim, §2.4).
			guardName(hub, owner, name, "event name");
			let set = listeners.get(name);
			if (!set) {
				set = new Set();
				listeners.set(name, set);
			}
			set.add(cb);
			return { dispose: () => set.delete(cb) };
		},
	};
}
