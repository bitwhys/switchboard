// Kernel spec §13 — Storage: kernel infrastructure, not a fifth
// primitive. Nothing here is registered, listed, `when`-gated, or
// bridged (§13.6).

import { SwitchboardError } from "./errors";

/**
 * Kernel spec §13.1 — the plugin's storage area: an async, JSON-valued
 * key-value façade bound invisibly to the plugin's id (§13.2).
 */
export interface StorageArea {
	get(key: string): Promise<unknown | undefined>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	keys(): Promise<string[]>;
	clear(): Promise<void>;
}

/**
 * Kernel spec §13.3 — the engine interface, public API: third parties
 * can ship engines without kernel changes. The engine receives the
 * namespace (the plugin id) explicitly (§13.2) and stores values
 * pre-serialized as JSON strings — serialization lives in the kernel's
 * façade, so value semantics are identical across engines. Methods may
 * be sync or async; the façade always awaits.
 */
export interface StorageEngine {
	get(
		namespace: string,
		key: string,
	): string | undefined | Promise<string | undefined>;
	set(namespace: string, key: string, value: string): void | Promise<void>;
	delete(namespace: string, key: string): void | Promise<void>;
	keys(namespace: string): string[] | Promise<string[]>;
	clear(namespace: string): void | Promise<void>;
}

/** §18.3 — the structural gate for the `storage` option. */
export function isStorageEngine(value: unknown): value is StorageEngine {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (["get", "set", "delete", "keys", "clear"] as const).every(
		(m) => typeof v[m] === "function",
	);
}

/**
 * Kernel spec §13.3 — `memoryEngine`: Map-backed, non-durable. For
 * tests and non-DOM environments, explicit no-persistence — and the
 * automatic fallback target when `localStorage` throws. Each call
 * returns a fresh engine (independent backing state).
 */
export function memoryEngine(): StorageEngine {
	const areas = new Map<string, Map<string, string>>();
	const area = (ns: string): Map<string, string> => {
		let a = areas.get(ns);
		if (!a) {
			a = new Map();
			areas.set(ns, a);
		}
		return a;
	};
	return {
		get: (ns, key) => area(ns).get(key),
		set: (ns, key, value) => {
			area(ns).set(key, value);
		},
		delete: (ns, key) => {
			area(ns).delete(key);
		},
		keys: (ns) => [...area(ns).keys()],
		clear: (ns) => {
			area(ns).clear();
		},
	};
}

/**
 * Kernel spec §13.3 — `localStorageEngine`: the default. Key-prefixed
 * `switchboard:<plugin-id>:<key>` (the §13.4 reachability promise —
 * this format is stable across kernel upgrades), sync calls behind the
 * façade's async surface. Whenever `localStorage` is missing or throws
 * (off-DOM, denied, quota), the engine flips permanently to a fresh
 * `memoryEngine` — `api.storage` never hard-fails, worst case it
 * degrades to session lifetime.
 */
export function localStorageEngine(): StorageEngine {
	let fallback: StorageEngine | undefined;

	const prefix = (ns: string) => `switchboard:${ns}:`;

	// Runs `op` against localStorage, or the memory fallback once any
	// localStorage access has thrown (the flip is sticky for this
	// engine's lifetime). `ls` is read per-call: never touched at
	// construction, so constructing off-DOM cannot crash (§13.3, §18.4).
	function attempt<T>(
		op: (ls: Storage) => T,
		viaFallback: (engine: StorageEngine) => T | Promise<T>,
	): T | Promise<T> {
		if (!fallback) {
			try {
				const ls = (globalThis as { localStorage?: Storage }).localStorage;
				if (ls) return op(ls);
			} catch {
				// fall through to the memory fallback below
			}
			fallback = memoryEngine();
		}
		return viaFallback(fallback);
	}

	const ownKeys = (ls: Storage, ns: string): string[] => {
		const p = prefix(ns);
		const keys: string[] = [];
		for (let i = 0; i < ls.length; i++) {
			const physical = ls.key(i);
			if (physical?.startsWith(p)) keys.push(physical.slice(p.length));
		}
		return keys;
	};

	return {
		get: (ns, key) =>
			attempt(
				(ls) => ls.getItem(prefix(ns) + key) ?? undefined,
				(engine) => engine.get(ns, key),
			),
		set: (ns, key, value) =>
			attempt(
				(ls) => {
					ls.setItem(prefix(ns) + key, value);
				},
				(engine) => engine.set(ns, key, value),
			),
		delete: (ns, key) =>
			attempt(
				(ls) => {
					ls.removeItem(prefix(ns) + key);
				},
				(engine) => engine.delete(ns, key),
			),
		keys: (ns) =>
			attempt(
				(ls) => ownKeys(ls, ns),
				(engine) => engine.keys(ns),
			),
		clear: (ns) =>
			attempt(
				(ls) => {
					for (const key of ownKeys(ls, ns)) {
						ls.removeItem(prefix(ns) + key);
					}
				},
				(engine) => engine.clear(ns),
			),
	};
}

interface StorageHost {
	emit(entry: {
		severity: "error";
		code: string;
		source: string;
		plugin?: string;
		subject?: string;
		message: string;
	}): void;
}

/**
 * Kernel spec §13.1/§13.5 — the per-plugin façade over the kernel's one
 * engine. Always present on `PluginApi` (no shape surprises); without
 * the `storage:use` grant every call rejects loudly (§13.5).
 */
export function createStorageArea(
	pluginId: string,
	engine: StorageEngine,
	granted: boolean,
	hub: StorageHost,
): StorageArea {
	const denied = (): Promise<never> => {
		// §13.5 loud: a named error rejected at the call site AND emitted.
		const error = new SwitchboardError({
			code: "permission-denied",
			source: "kernel",
			plugin: pluginId,
			subject: "storage:use",
			message: `\`${pluginId}\` used \`api.storage\` without the \`storage:use\` permission — storage is enforced and default-closed (§13.5)`,
		});
		hub.emit({
			severity: "error",
			code: error.code,
			source: error.source,
			plugin: error.plugin,
			subject: error.subject,
			message: error.message,
		});
		return Promise.reject(error);
	};

	return {
		async get(key) {
			if (!granted) return denied();
			const raw = await engine.get(pluginId, key);
			if (raw === undefined) return undefined;
			try {
				return JSON.parse(raw);
			} catch {
				// §13.4 defensive read: storage is untrusted input — a value
				// that is no longer parseable JSON reads as absent.
				return undefined;
			}
		},
		async set(key, value) {
			if (!granted) return denied();
			// §13.1: values MUST be JSON-serializable. Cycles throw here
			// natively; undefined/functions/symbols serialize to nothing.
			const raw = JSON.stringify(value);
			if (raw === undefined) {
				throw new TypeError(
					`storage values must be JSON-serializable (§13.1); got ${typeof value}`,
				);
			}
			await engine.set(pluginId, key, raw);
		},
		async delete(key) {
			if (!granted) return denied();
			await engine.delete(pluginId, key);
		},
		async keys() {
			if (!granted) return denied();
			return await engine.keys(pluginId);
		},
		async clear() {
			if (!granted) return denied();
			await engine.clear(pluginId);
		},
	};
}
