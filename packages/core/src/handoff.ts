// Kernel spec §17 — the kernel handoff: a tiny push/subscribe object on
// `globalThis.__SWITCHBOARD__`, so kernels and their consumers find each
// other in either load order without the application wiring anything.
// Whichever code touches the global first creates it; the §17.1 shape
// and semantics are the contract, so independently shipped copies of
// this shim interoperate.

/** Kernel spec §17.1 — the handoff point's shape. */
export interface KernelHandoff {
	/** Announce a kernel; retained for replay until retracted (§17.3). */
	push(kernel: unknown): void;
	/** Withdraw an announce; no-op for never-announced or already-retracted (§17.3). */
	retract(kernel: unknown): void;
	/** Synchronous replay of every live kernel in announce order, then live pushes. */
	subscribe(
		cb: (kernel: unknown) => void,
		onRetract?: (kernel: unknown) => void,
	): () => void;
}

interface Subscriber {
	cb: (kernel: unknown) => void;
	onRetract?: (kernel: unknown) => void;
}

export function createKernelHandoff(): KernelHandoff {
	// announced-and-not-retracted, in announce order (§17.1)
	const live: unknown[] = [];
	const subscribers = new Set<Subscriber>();

	return {
		push(kernel) {
			if (live.includes(kernel)) return;
			live.push(kernel);
			for (const s of [...subscribers]) {
				try {
					s.cb(kernel);
				} catch {
					// a throwing subscriber must not break the announcer or its peers
				}
			}
		},
		retract(kernel) {
			const index = live.indexOf(kernel);
			if (index === -1) return;
			live.splice(index, 1);
			for (const s of [...subscribers]) {
				try {
					s.onRetract?.(kernel);
				} catch {
					// same containment
				}
			}
		},
		subscribe(cb, onRetract) {
			const subscriber: Subscriber = { cb, onRetract };
			subscribers.add(subscriber);
			// §17.1: replay is synchronous and covers only live kernels — a
			// kernel retracted before subscribe simply never appears (§17.3).
			for (const kernel of [...live]) {
				try {
					cb(kernel);
				} catch {
					// same containment
				}
			}
			return () => {
				subscribers.delete(subscriber);
			};
		},
	};
}

/** §17.1 — reuse the global if some earlier copy created it, else create it. */
export function ensureHandoff(): KernelHandoff {
	const g = globalThis as { __SWITCHBOARD__?: KernelHandoff };
	g.__SWITCHBOARD__ ??= createKernelHandoff();
	return g.__SWITCHBOARD__;
}

/**
 * §17.2 — how many kernels are currently live, counted through the
 * contract surface only (subscribe replays exactly the live set), so it
 * works against any conformant shim, not just ours.
 */
export function countLiveKernels(handoff: KernelHandoff): number {
	let count = 0;
	const unsubscribe = handoff.subscribe(() => {
		count += 1;
	});
	unsubscribe();
	return count;
}
