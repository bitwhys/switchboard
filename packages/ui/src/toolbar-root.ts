// Toolbar contract §8.1 (P1 — one open shadow root) and §8.8 (P8 — the
// labelled landmark): the chrome's root setup. The adapter supplies the
// host element and the label, appends the host last in the host <body>
// (§8.8 corollary), and styles what goes inside.

import type { Disposable } from "./disposable";

export interface ToolbarRootOptions {
	/** Accessible name for the complementary landmark wrapping all chrome (§8.8). */
	label: string;
}

export interface ToolbarRoot extends Disposable {
	/** The single open shadow root all chrome lives in (§8.1). */
	shadowRoot: ShadowRoot;
	/** The labelled landmark; every chrome element belongs inside it (§8.8). */
	landmark: HTMLElement;
}

export function createToolbarRoot(
	host: HTMLElement,
	options: ToolbarRootOptions,
): ToolbarRoot {
	if (typeof options?.label !== "string" || options.label.trim() === "") {
		throw new TypeError(
			"createToolbarRoot: options.label must be a non-empty string — the landmark must be labelled (toolbar contract §8.8)",
		);
	}
	// §8.1 — open, never closed. attachShadow itself throws when the host
	// already carries a root, which enforces "single root" natively.
	const shadowRoot = host.attachShadow({ mode: "open" });
	const landmark = document.createElement("aside");
	landmark.setAttribute("aria-label", options.label);
	shadowRoot.append(landmark);
	return {
		shadowRoot,
		landmark,
		dispose(): void {
			landmark.remove();
		},
	};
}
