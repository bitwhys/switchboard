// Toolbar contract §5.2 / §8.4 (P4 — mount, dispose, force-clear): the
// managed-container lifecycle. The adapter mounts on open and unmounts on
// close; what boots inside the container is the plugin's business. No
// keep-alive in v1 — every open mounts fresh.

/** What a panel `mount` may hand back: a kernel Disposable, a plain function, or nothing. */
export type MountCleanup = { dispose(): void } | (() => void);

export type MountFn = (container: HTMLElement) => MountCleanup | undefined;

export interface MountController {
	readonly mounted: boolean;
	/** §5.2 — mount on open. Throws when already mounted; every open mounts fresh. */
	mount(mount: MountFn): void;
	/**
	 * §5.2/§8.4 — dispose then force-clear, in that order. The clear is
	 * unconditional: a throwing dispose is rethrown *after* the container
	 * has been cleared, for the adapter to report. No-op when unmounted.
	 */
	unmount(): void;
}

export function createMountController(container: HTMLElement): MountController {
	let cleanup: MountCleanup | undefined;
	let mounted = false;
	return {
		get mounted(): boolean {
			return mounted;
		},
		mount(mount: MountFn): void {
			if (mounted) {
				throw new Error(
					"createMountController: already mounted — every open mounts fresh (toolbar contract §5.2)",
				);
			}
			mounted = true;
			cleanup = mount(container) ?? undefined;
		},
		unmount(): void {
			if (!mounted) return;
			const pending = cleanup;
			cleanup = undefined;
			mounted = false;
			try {
				if (typeof pending === "function") pending();
				else pending?.dispose();
			} finally {
				// §8.4 — the clear runs even when dispose throws.
				container.replaceChildren();
			}
		},
	};
}
