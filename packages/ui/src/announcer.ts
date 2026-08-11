// Toolbar contract §8.5 (P5 — announcements): a visually-hidden aria-live
// region inside the shadow root as the default voice, plus the adapter-owned
// light-DOM fallback region, switchable at runtime for screen-reader
// combinations where the shadow-internal region proves silent. Plain text
// only — regions are mutated via textContent, so markup never parses.

import type { Disposable } from "./disposable";

export interface AnnouncerOptions {
	/** Parent inside the shadow root for the default region (§8.5). */
	shadowParent: HTMLElement | ShadowRoot;
	/** Light-DOM parent for the fallback region — typically the host element's parent. */
	lightParent: HTMLElement;
}

export interface Announcer extends Disposable {
	/** Announce plain text through the currently selected region. */
	announce(text: string): void;
	/** Switch announcements to the light-DOM fallback region (and back). */
	useFallback(on: boolean): void;
}

const HIDDEN_STYLE =
	"position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;";

function liveRegion(): HTMLElement {
	const el = document.createElement("div");
	el.setAttribute("aria-live", "polite");
	el.style.cssText = HIDDEN_STYLE;
	return el;
}

export function createAnnouncer(options: AnnouncerOptions): Announcer {
	const shadowRegion = liveRegion();
	const lightRegion = liveRegion();
	options.shadowParent.append(shadowRegion);
	options.lightParent.append(lightRegion);
	let fallback = false;
	let pending: ReturnType<typeof setTimeout> | undefined;
	return {
		announce(text: string): void {
			const region = fallback ? lightRegion : shadowRegion;
			// Clear now, set in a separate task, so repeating the same message
			// re-announces (the spike-validated retrigger).
			shadowRegion.textContent = "";
			lightRegion.textContent = "";
			if (pending !== undefined) clearTimeout(pending);
			pending = setTimeout(() => {
				pending = undefined;
				region.textContent = String(text);
			}, 30);
		},
		useFallback(on: boolean): void {
			fallback = on;
		},
		dispose(): void {
			if (pending !== undefined) clearTimeout(pending);
			shadowRegion.remove();
			lightRegion.remove();
		},
	};
}
