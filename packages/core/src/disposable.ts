// Kernel spec §4.3 — Disposable-based teardown.

export interface Disposable {
	dispose(): void;
}

/**
 * Tracks every Disposable the kernel hands out for a plugin, so
 * deactivation cleans up everything the kernel can see (§4.3).
 * Disposes in reverse order of tracking; a throwing dispose does not
 * prevent the rest.
 */
export class DisposableStore implements Disposable {
	private items: Disposable[] = [];

	track<T extends Disposable>(d: T): T {
		this.items.push(d);
		return d;
	}

	dispose(): void {
		const items = this.items.reverse();
		this.items = [];
		for (const d of items) {
			try {
				d.dispose();
			} catch {
				// teardown is best-effort; one failing dispose must not strand the rest
			}
		}
	}
}
