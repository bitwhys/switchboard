// Kernel spec §9 — Services: named, live in-page JS values shared
// between plugins — never serialized, never bridged. `get` resolves the
// moment the provider registers (activation-order-insensitive), and
// rejects immediately when no installed plugin provides the capability,
// so it never hangs on a name nobody will ever register.

import type { DiagnosticsHub } from "./diagnostics";
import type { Disposable } from "./disposable";
import { guardName, guardReservedWrite, loud } from "./guards";

/** Kernel spec §9 — the per-plugin services surface. */
export interface ServicesApi {
	register(name: string, service: unknown): Disposable;
	get(name: string): Promise<unknown>;
	tryGet(name: string): unknown | undefined;
}

/** What the kernel knows about installed plugins, for §9's rejection rules. */
export interface ProviderIndex {
	/** The installed plugin providing this capability name (§10.1), if any. */
	providerOf(name: string): string | undefined;
	/** The failure a provider's settled-and-failed setup produced, if it has. */
	failureOf(pluginId: string): unknown | undefined;
}

export interface ServiceRegistry {
	register(owner: string, name: string, service: unknown): Disposable;
	get(owner: string, name: string): Promise<unknown>;
	tryGet(owner: string, name: string): unknown | undefined;
	/** Kernel hook: a provider's setup failed — reject its pending gets. */
	onPluginFailed(pluginId: string, failure: unknown): void;
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

export function createServiceRegistry(
	hub: DiagnosticsHub,
	providers: ProviderIndex,
): ServiceRegistry {
	const services = new Map<string, unknown>();
	const pending = new Map<string, Pending[]>();

	return {
		register(owner, name, service) {
			guardName(hub, owner, name, "service name");
			guardReservedWrite(hub, owner, name, "registering service");
			// §2.2 / §9: service names are an exclusive kind.
			if (services.has(name)) {
				throw loud(hub, {
					code: "name-taken",
					source: "kernel",
					plugin: owner,
					subject: name,
					message: `service ${JSON.stringify(name)} is already registered (§9)`,
				});
			}
			// §10.4: a registered service name no plugin's `provides` declares
			// is manifest drift — a dev-mode warning, never an error.
			if (providers.providerOf(name) === undefined) {
				hub.emit({
					severity: "warning",
					code: "manifest-drift",
					source: "kernel",
					plugin: owner,
					subject: name,
					message: `service ${JSON.stringify(name)} appears in no plugin's provides — declare it so the §10 check can see it (§10.4)`,
				});
			}
			services.set(name, service);
			const waiters = pending.get(name);
			pending.delete(name);
			for (const w of waiters ?? []) w.resolve(service);
			// §9: disposal unregisters.
			return { dispose: () => services.delete(name) };
		},

		async get(owner, name) {
			guardName(hub, owner, name, "service name");
			if (services.has(name)) return services.get(name);
			const provider = providers.providerOf(name);
			if (provider === undefined) {
				// §9: reject immediately — waiting would hang forever.
				throw loud(hub, {
					code: "service-unavailable",
					source: "kernel",
					plugin: owner,
					subject: name,
					message: `no installed plugin provides ${JSON.stringify(name)} — get would never resolve (§9)`,
				});
			}
			// §9: if the provider's own setup (already) failed, pending gets
			// reject with that failure.
			const failure = providers.failureOf(provider);
			if (failure !== undefined) throw failure;
			return new Promise((resolve, reject) => {
				let waiters = pending.get(name);
				if (!waiters) {
					waiters = [];
					pending.set(name, waiters);
				}
				waiters.push({ resolve, reject });
			});
		},

		tryGet(owner, name) {
			guardName(hub, owner, name, "service name");
			return services.get(name);
		},

		onPluginFailed(pluginId, failure) {
			for (const [name, waiters] of [...pending]) {
				if (providers.providerOf(name) === pluginId) {
					pending.delete(name);
					for (const w of waiters) w.reject(failure);
				}
			}
		},
	};
}
