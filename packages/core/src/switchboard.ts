// Kernel spec §18 — `createSwitchboard`: the one public construction
// surface. Synchronous — the instance returns immediately and the §17
// announce fires inside the call — while activation proceeds unawaited
// (`ready` is the settling signal). Client-only, one kernel per tab
// (§18.4); the kernel never sniffs its environment.

import type { DiagnosticsHub } from "./diagnostics";
import { countLiveKernels, ensureHandoff } from "./handoff";
import {
	createKernel,
	type Switchboard,
	type SwitchboardOptions,
} from "./kernel";

export function createSwitchboard(options: SwitchboardOptions): Switchboard {
	// §18.3: the only synchronous throw is `invalid-options`, inside here.
	let hub: DiagnosticsHub | undefined;
	const kernel = createKernel(options, (h) => {
		hub = h;
	});

	const handoff = ensureHandoff();
	// §17.2: counted before our own announce, through the contract
	// surface only, so any conformant shim copy works.
	const liveBefore = countLiveKernels(handoff);

	let disposed = false;
	const instance: Switchboard = {
		...kernel,
		// §18.2/§17.3: teardown, then retract our own announce — the
		// dispose-then-construct path replaces a kernel without tripping
		// the second-kernel warning (HMR, test isolation).
		dispose() {
			if (disposed) return;
			disposed = true;
			kernel.dispose();
			handoff.retract(instance);
		},
	};

	if (liveBefore > 0) {
		// §17.2: a second kernel while the first is live — dev-mode
		// warning on the *second* instance's channel; consumers keep the
		// first, so this one is announced but ignored. Deferred one
		// microtask (like activation, §18.1) so the caller can subscribe
		// to the synchronously-returned instance before it fires.
		queueMicrotask(() => {
			warnDuplicate(hub);
		});
	}

	// §17.1: announcing is unconditional and synchronous — load-bearing
	// wiring, not a diagnostic.
	handoff.push(instance);
	return instance;
}

function warnDuplicate(hub: DiagnosticsHub | undefined): void {
	hub?.emit({
		severity: "warning",
		code: "duplicate-kernel",
		source: "kernel",
		message: `a kernel is already announced and live on this page — first live kernel wins, single-kernel consumers will ignore this one (§17.2)`,
	});
}
