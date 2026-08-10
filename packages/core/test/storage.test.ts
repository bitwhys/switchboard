import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { SwitchboardError } from "../src/errors";
import { createKernel, type SwitchboardOptions } from "../src/kernel";
import type { PluginApi, PluginDefinition } from "../src/plugin";
import { localStorageEngine, memoryEngine } from "../src/storage";

// Kernel spec §13 — Storage: kernel infrastructure, not a fifth primitive.
// The per-plugin area (§13.1), invisible namespacing (§13.2), engines
// (§13.3), reachability durability (§13.4), the enforced `storage:use`
// gate (§13.5), and no bridge exposure (§13.6).

const base = { name: "Test Plugin", version: "1.0.0" };

async function harness(
	plugins: PluginDefinition[],
	options?: Partial<SwitchboardOptions>,
) {
	const kernel = createKernel({
		plugins,
		storage: memoryEngine(),
		diagnostics: { console: false },
		...options,
	});
	const seen: Diagnostic[] = [];
	kernel.diagnostics.subscribe((d) => seen.push(d));
	await kernel.ready;
	return { seen, kernel };
}

/** One activated plugin; returns its PluginApi. */
async function apiOf(
	manifest: Partial<PluginDefinition> & { id: string },
	options?: Partial<SwitchboardOptions>,
) {
	let api: PluginApi | undefined;
	const { seen } = await harness(
		[
			{
				...base,
				...manifest,
				setup: (a) => {
					api = a;
				},
			} as PluginDefinition,
		],
		options,
	);
	if (!api) throw new Error("plugin did not activate");
	return { api, seen };
}

describe("kernel §13.5 the storage:use gate — enforced, default-closed", () => {
	it("without the grant, api.storage is present (no shape surprises) but every call rejects with permission-denied naming storage:use", async () => {
		const { api, seen } = await apiOf({ id: "acme.ungranted" });
		expect(api.storage).toBeDefined();
		const calls = [
			api.storage.get("k"),
			api.storage.set("k", 1),
			api.storage.delete("k"),
			api.storage.keys(),
			api.storage.clear(),
		];
		for (const p of calls) {
			await expect(p).rejects.toMatchObject({
				name: "SwitchboardError",
				code: "permission-denied",
				plugin: "acme.ungranted",
				subject: "storage:use",
			});
			await expect(p).rejects.toThrow(/storage:use/);
		}
		// §13.5 loud = rejected at the call site AND emitted on the channel.
		expect(
			seen.filter(
				(d) => d.code === "permission-denied" && d.severity === "error",
			),
		).toHaveLength(5);
	});

	it("with the storage:use grant, calls do not reject with permission-denied", async () => {
		const { api, seen } = await apiOf({
			id: "acme.granted",
			permissions: ["storage:use"],
		});
		await api.storage.set("k", 1);
		expect(await api.storage.get("k")).toBe(1);
		expect(seen.filter((d) => d.code === "permission-denied")).toHaveLength(0);
	});

	it("§12.2: an unknown permission string grants nothing — storage:everything does not open the gate", async () => {
		const { api, seen } = await apiOf({
			id: "acme.wishful",
			permissions: ["storage:everything"],
		});
		await expect(api.storage.get("k")).rejects.toMatchObject({
			code: "permission-denied",
		});
		// and the unknown string was tolerated with the §12.2 warning
		expect(seen).toContainEqual(
			expect.objectContaining({
				code: "unknown-permission",
				subject: "storage:everything",
			}),
		);
	});

	it("rejections are SwitchboardError instances (diagnostics §3)", async () => {
		const { api } = await apiOf({ id: "acme.instanceof" });
		await expect(api.storage.get("k")).rejects.toBeInstanceOf(SwitchboardError);
	});
});

const granted = { permissions: ["storage:use"] };

describe("kernel §13.1 the storage area — async, JSON-valued", () => {
	it("round-trips JSON values: objects, arrays, strings, numbers, booleans, null", async () => {
		const { api } = await apiOf({ id: "acme.roundtrip", ...granted });
		const values: [string, unknown][] = [
			["object", { a: 1, nested: { b: [true, null] } }],
			["array", [1, "two", { three: 3 }]],
			["string", "hello"],
			["number", 42.5],
			["boolean", false],
			["null", null],
		];
		for (const [key, value] of values) {
			await api.storage.set(key, value);
			expect(await api.storage.get(key)).toEqual(value);
		}
	});

	it("get of a never-set key resolves undefined", async () => {
		const { api } = await apiOf({ id: "acme.absent", ...granted });
		expect(await api.storage.get("never")).toBeUndefined();
	});

	it("delete removes a key; keys lists what is set; clear empties the area", async () => {
		const { api } = await apiOf({ id: "acme.lifecycle", ...granted });
		await api.storage.set("a", 1);
		await api.storage.set("b", 2);
		expect((await api.storage.keys()).sort()).toEqual(["a", "b"]);
		await api.storage.delete("a");
		expect(await api.storage.get("a")).toBeUndefined();
		expect(await api.storage.keys()).toEqual(["b"]);
		await api.storage.clear();
		expect(await api.storage.keys()).toEqual([]);
		expect(await api.storage.get("b")).toBeUndefined();
	});

	it("every method is async — returns a Promise even over the sync engines", async () => {
		const { api } = await apiOf({ id: "acme.async", ...granted });
		expect(api.storage.set("k", 1)).toBeInstanceOf(Promise);
		expect(api.storage.get("k")).toBeInstanceOf(Promise);
		expect(api.storage.delete("k")).toBeInstanceOf(Promise);
		expect(api.storage.keys()).toBeInstanceOf(Promise);
		expect(api.storage.clear()).toBeInstanceOf(Promise);
	});

	it("values MUST be JSON-serializable: a cyclic value rejects and stores nothing", async () => {
		const { api } = await apiOf({ id: "acme.cycle", ...granted });
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		await expect(api.storage.set("k", cyclic)).rejects.toBeInstanceOf(
			TypeError,
		);
		expect(await api.storage.keys()).toEqual([]);
	});

	it("a value that serializes to nothing (undefined, function) rejects", async () => {
		const { api } = await apiOf({ id: "acme.void", ...granted });
		await expect(api.storage.set("k", undefined)).rejects.toBeInstanceOf(
			TypeError,
		);
		await expect(api.storage.set("k", () => 1)).rejects.toBeInstanceOf(
			TypeError,
		);
	});

	it("non-JSON-native values are normalized by serialization, not preserved (a Date reads back as its ISO string)", async () => {
		const { api } = await apiOf({ id: "acme.normalize", ...granted });
		const date = new Date("2026-01-02T03:04:05.000Z");
		await api.storage.set("k", date);
		expect(await api.storage.get("k")).toBe("2026-01-02T03:04:05.000Z");
	});
});

describe("kernel §13.2 namespacing — invisible, no cross-plugin access", () => {
	it("two plugins using the same key never see each other's values", async () => {
		const apis: Record<string, PluginApi> = {};
		await harness([
			{
				id: "acme.first",
				...base,
				permissions: ["storage:use"],
				setup: async (api) => {
					apis["acme.first"] = api;
					await api.storage.set("shared-key", "first's value");
				},
			},
			{
				id: "acme.second",
				...base,
				permissions: ["storage:use"],
				setup: async (api) => {
					apis["acme.second"] = api;
					await api.storage.set("shared-key", "second's value");
				},
			},
		]);
		expect(await apis["acme.first"]?.storage.get("shared-key")).toBe(
			"first's value",
		);
		expect(await apis["acme.second"]?.storage.get("shared-key")).toBe(
			"second's value",
		);
		expect(await apis["acme.first"]?.storage.keys()).toEqual(["shared-key"]);
	});

	it("the plugin-facing API has no namespace parameter anywhere — a plugin cannot name a namespace, so it cannot escape one", async () => {
		const { api } = await apiOf({ id: "acme.arity", ...granted });
		// The five methods take exactly key / key+value / key / none / none.
		expect(api.storage.get.length).toBe(1);
		expect(api.storage.set.length).toBe(2);
		expect(api.storage.delete.length).toBe(1);
		expect(api.storage.keys.length).toBe(0);
		expect(api.storage.clear.length).toBe(0);
	});
});

/** A Web-Storage-shaped fake backed by a Map, installable on globalThis. */
function fakeLocalStorage(overrides: Partial<Storage> = {}) {
	const store = new Map<string, string>();
	const fake = {
		store,
		getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
		setItem: (k: string, v: string) => {
			store.set(k, String(v));
		},
		removeItem: (k: string) => {
			store.delete(k);
		},
		key: (i: number) => [...store.keys()][i] ?? null,
		get length() {
			return store.size;
		},
		clear: () => store.clear(),
		...overrides,
	};
	return fake;
}

function withLocalStorage<T>(fake: unknown, fn: () => Promise<T>): Promise<T> {
	(globalThis as Record<string, unknown>).localStorage = fake;
	return fn().finally(() => {
		delete (globalThis as Record<string, unknown>).localStorage;
	});
}

describe("kernel §13.3 localStorageEngine — the default, key-prefixed", () => {
	it("is the default engine: with no storage option, values land in localStorage under switchboard:<plugin-id>:<key>", async () => {
		const fake = fakeLocalStorage();
		await withLocalStorage(fake, async () => {
			const { api } = await apiOf(
				{ id: "acme.default", ...granted },
				{ storage: undefined },
			);
			await api.storage.set("theme", "dark");
			// §13.4: the physical key format is the durability promise.
			expect(fake.store.get("switchboard:acme.default:theme")).toBe(
				JSON.stringify("dark"),
			);
		});
	});

	it("keys and clear touch only the plugin's own prefix — sibling namespaces and unrelated app keys survive", async () => {
		const fake = fakeLocalStorage();
		fake.setItem("app-own-key", "untouched");
		fake.setItem("switchboard:acme.other:k", '"other"');
		await withLocalStorage(fake, async () => {
			const { api } = await apiOf(
				{ id: "acme.tidy", ...granted },
				{ storage: localStorageEngine() },
			);
			await api.storage.set("a", 1);
			await api.storage.set("b", 2);
			expect((await api.storage.keys()).sort()).toEqual(["a", "b"]);
			await api.storage.clear();
			expect(await api.storage.keys()).toEqual([]);
			expect(fake.store.get("app-own-key")).toBe("untouched");
			expect(fake.store.get("switchboard:acme.other:k")).toBe('"other"');
		});
	});

	it("keys containing colons survive the prefix format round-trip", async () => {
		const fake = fakeLocalStorage();
		await withLocalStorage(fake, async () => {
			const { api } = await apiOf(
				{ id: "acme.colons", ...granted },
				{ storage: localStorageEngine() },
			);
			await api.storage.set("a:b:c", "value");
			expect(await api.storage.get("a:b:c")).toBe("value");
			expect(await api.storage.keys()).toEqual(["a:b:c"]);
		});
	});

	it("§13.4 defensive read: a stored value that is no longer parseable JSON reads as absent, never throws", async () => {
		const fake = fakeLocalStorage();
		fake.setItem("switchboard:acme.defensive:mangled", "{not json");
		await withLocalStorage(fake, async () => {
			const { api } = await apiOf(
				{ id: "acme.defensive", ...granted },
				{ storage: localStorageEngine() },
			);
			expect(await api.storage.get("mangled")).toBeUndefined();
		});
	});

	it("falls back to memory when localStorage throws — api.storage never hard-fails, worst case session lifetime", async () => {
		const throwing = fakeLocalStorage({
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
		});
		await withLocalStorage(throwing, async () => {
			const { api } = await apiOf(
				{ id: "acme.quota", ...granted },
				{ storage: localStorageEngine() },
			);
			await api.storage.set("k", "survives in memory");
			expect(await api.storage.get("k")).toBe("survives in memory");
		});
	});

	it("construction never crashes off-DOM: no localStorage global at all, the default engine still serves reads and writes", async () => {
		// vitest runs in node — there is no localStorage here.
		expect(
			(globalThis as Record<string, unknown>).localStorage,
		).toBeUndefined();
		const { api } = await apiOf(
			{ id: "acme.node", ...granted },
			{ storage: undefined },
		);
		await api.storage.set("k", 1);
		expect(await api.storage.get("k")).toBe(1);
	});
});

describe("kernel §13.3 memoryEngine — non-durable, per-engine state", () => {
	it("two engines share nothing: same plugin id, independent state", async () => {
		const a = await apiOf({ id: "acme.mem", ...granted });
		await a.api.storage.set("k", "in engine A");
		const b = await apiOf({ id: "acme.mem", ...granted });
		expect(await b.api.storage.get("k")).toBeUndefined();
	});

	it("the engine interface is public API and third-party engines plug in without kernel changes", async () => {
		const writes: [string, string, string][] = [];
		const custom = {
			get: () => undefined,
			set: (ns: string, key: string, value: string) => {
				writes.push([ns, key, value]);
			},
			delete: () => {},
			keys: () => [],
			clear: () => {},
		};
		const { api } = await apiOf(
			{ id: "acme.custom", ...granted },
			{ storage: custom },
		);
		await api.storage.set("k", { custom: true });
		// §13.2: the engine receives the namespace (the plugin id) explicitly.
		expect(writes).toEqual([
			["acme.custom", "k", JSON.stringify({ custom: true })],
		]);
	});

	it("§18.3: a storage option that is not a storage engine throws invalid-options synchronously", () => {
		let thrown: unknown;
		try {
			createKernel({
				plugins: [],
				storage: { get: () => undefined } as never,
				diagnostics: { console: false },
			});
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toMatchObject({
			name: "SwitchboardError",
			code: "invalid-options",
		});
	});
});

describe("kernel §13.6 storage never bridges", () => {
	it("no bridge:storage permission exists or is reserved — it warns as unknown and grants nothing (§12.2)", async () => {
		const { seen } = await apiOf({
			id: "acme.hopeful",
			permissions: ["bridge:storage"],
		});
		expect(seen).toContainEqual(
			expect.objectContaining({
				code: "unknown-permission",
				subject: "bridge:storage",
			}),
		);
	});
});

describe("kernel §14 the wire-legal rule — kernel-side posture", () => {
	it("the kernel never deep-inspects primitive payloads: a non-wire-legal event payload passes through undisturbed (enforcement is the bridge's)", async () => {
		const { api, seen } = await apiOf({ id: "acme.wire", ...granted });
		let received: unknown;
		api.events.on("acme.wire.ping", (payload) => {
			received = payload;
		});
		const notWireLegal = new Map([["a", 1]]);
		api.events.emit("acme.wire.ping", notWireLegal);
		expect(received).toBe(notWireLegal);
		expect(seen.filter((d) => d.severity === "error")).toHaveLength(0);
	});
});
