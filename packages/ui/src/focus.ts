// Toolbar contract §8.6 (P6 — shadow-aware focus bookkeeping):
// document.activeElement reports the shadow host, not the truly focused
// element — drill through shadowRoot.activeElement instead, and validate
// stored restore targets before restoring.

/** The truly focused element, drilled through any open shadow roots (§8.6). */
export function deepActiveElement(): Element | null {
	let el: Element | null = document.activeElement;
	while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
	return el;
}

/**
 * §8.6 — validated focus restore: the stored element may be gone (it may
 * have lived inside a disposed panel) or be <body>; then focus falls back
 * to the adapter-supplied target — typically the panel's toggle.
 */
export function restoreFocus(
	stored: Element | null | undefined,
	fallback: HTMLElement,
): void {
	const target =
		stored instanceof HTMLElement &&
		stored.isConnected &&
		stored !== document.body
			? stored
			: fallback;
	target.focus();
}
