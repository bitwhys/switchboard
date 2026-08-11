// Toolbar contract §8.7 (P7 — strip semantics): the roving-tabindex
// mechanism — exactly one tab stop, Arrow-key navigation with wrap-around,
// Home/End to the edges. The adapter renders the strip itself
// (role="toolbar", items, separators, badges folded into accessible
// names); this controller only manages which item holds the tab stop.

import type { Disposable } from "./disposable";

export interface RovingStripOptions {
	/** Selector for the strip's items; defaults to "button". Separators must not match. */
	itemSelector?: string;
}

export interface RovingStrip extends Disposable {
	/** Re-collect items after the adapter re-renders; keeps the current stop when it survives. */
	refresh(): void;
}

export function createRovingStrip(
	strip: HTMLElement,
	options: RovingStripOptions = {},
): RovingStrip {
	const selector = options.itemSelector ?? "button";
	const items = (): HTMLElement[] =>
		Array.from(strip.querySelectorAll<HTMLElement>(selector));

	function setStop(target: HTMLElement): void {
		for (const item of items()) item.tabIndex = item === target ? 0 : -1;
	}

	function activeElement(): Element | null {
		const root = strip.getRootNode();
		return root instanceof ShadowRoot
			? root.activeElement
			: document.activeElement;
	}

	const onKeydown = (e: KeyboardEvent): void => {
		if (
			e.key !== "ArrowRight" &&
			e.key !== "ArrowLeft" &&
			e.key !== "Home" &&
			e.key !== "End"
		) {
			return;
		}
		const all = items();
		const i = all.indexOf(activeElement() as HTMLElement);
		if (i < 0) return;
		let next: HTMLElement;
		if (e.key === "Home") next = all[0];
		else if (e.key === "End") next = all[all.length - 1];
		else {
			const step = e.key === "ArrowRight" ? 1 : -1;
			next = all[(i + step + all.length) % all.length];
		}
		setStop(next);
		next.focus();
		e.preventDefault();
	};

	// Focusing an item by any route (pointer, focus restore to a toggle)
	// makes it the stop, so tabbing back into the strip returns to it.
	const onFocusin = (e: FocusEvent): void => {
		const target = e.target;
		if (target instanceof HTMLElement && items().includes(target)) {
			setStop(target);
		}
	};

	strip.addEventListener("keydown", onKeydown);
	strip.addEventListener("focusin", onFocusin);

	const first = items()[0];
	if (first) setStop(first);

	return {
		refresh(): void {
			const all = items();
			if (all.length === 0) return;
			setStop(all.find((item) => item.tabIndex === 0) ?? all[0]);
		},
		dispose(): void {
			strip.removeEventListener("keydown", onKeydown);
			strip.removeEventListener("focusin", onFocusin);
		},
	};
}
