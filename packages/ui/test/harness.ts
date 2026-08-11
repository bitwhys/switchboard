// Adapter-style composition of every factory into a working chrome —
// the port of prototypes/shadow-panel-a11y/'s scene, used by the axe gate
// and reusable pieces for the per-pattern tests.

import { createAnnouncer } from "../src/announcer";
import { deepActiveElement, restoreFocus } from "../src/focus";
import { createMountController } from "../src/mount";
import { createPanelDialog } from "../src/panel-dialog";
import { createRovingStrip } from "../src/roving-strip";
import { createToolbarRoot } from "../src/toolbar-root";

const CHROME_STYLE = `
	.vh { position: absolute; width: 1px; height: 1px; overflow: hidden;
		clip-path: inset(50%); white-space: nowrap; }
	.sep { width: 1px; align-self: stretch; }
`;

export interface ChromePanel {
	dialog: HTMLDialogElement;
	toggle: HTMLButtonElement;
	open(opts?: { modal?: boolean }): void;
	close(): void;
}

export interface Chrome {
	host: HTMLElement;
	shadowRoot: ShadowRoot;
	strip: HTMLElement;
	metrics: ChromePanel;
	feedback: ChromePanel;
	dispose(): void;
}

/**
 * Builds the full chrome: a two-cluster strip with a separator, two
 * <dialog> panels with mounted plugin-style bodies, and the announcer —
 * everything inside one labelled landmark in one open shadow root.
 */
export function buildChrome(): Chrome {
	const host = document.createElement("switchboard-toolbar");
	document.body.append(host);

	const root = createToolbarRoot(host, {
		label: "Switchboard developer tools",
	});
	const style = document.createElement("style");
	style.textContent = CHROME_STYLE;
	root.shadowRoot.prepend(style);

	root.landmark.innerHTML = `
		<div role="toolbar" aria-label="Switchboard toolbar" id="strip">
			<button type="button" id="cmd-refresh">⟳<span class="vh">Refresh metrics</span></button>
			<button type="button" id="toggle-metrics" aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-metrics">📊<span class="vh">Metrics panel</span></button>
			<div class="sep" role="separator" aria-orientation="vertical"></div>
			<button type="button" id="toggle-feedback" aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-feedback">💬<span class="vh">Feedback panel</span></button>
		</div>
		<dialog id="panel-metrics" aria-labelledby="panel-metrics-title">
			<div><h2 id="panel-metrics-title">Metrics</h2>
			<button type="button" data-close>✕<span class="vh">Close Metrics panel</span></button></div>
			<div id="mount-metrics"></div>
		</dialog>
		<dialog id="panel-feedback" aria-labelledby="panel-feedback-title">
			<div><h2 id="panel-feedback-title">Feedback</h2>
			<button type="button" data-close>✕<span class="vh">Close Feedback panel</span></button></div>
			<div id="mount-feedback"></div>
		</dialog>
	`;

	const byId = <T extends HTMLElement>(id: string): T => {
		const el = root.shadowRoot.getElementById(id);
		if (!el) throw new Error(`harness: missing #${id}`);
		return el as T;
	};

	const strip = byId<HTMLElement>("strip");
	const roving = createRovingStrip(strip);
	const announcer = createAnnouncer({
		shadowParent: root.landmark,
		lightParent: document.body,
	});

	const disposables: Array<{ dispose(): void }> = [roving, announcer, root];

	function wirePanel(
		panelId: string,
		toggleId: string,
		mountId: string,
		title: string,
		mountBody: (container: HTMLElement) => (() => void) | undefined,
	): ChromePanel {
		const dialog = byId<HTMLDialogElement>(panelId);
		const toggle = byId<HTMLButtonElement>(toggleId);
		const mounter = createMountController(byId(mountId));
		let restoreTo: Element | null = null;
		const handle = createPanelDialog(dialog, {
			onClose() {
				// The adapter's one close path: dispose+clear, state, restore.
				mounter.unmount();
				toggle.setAttribute("aria-expanded", "false");
				announcer.announce(`${title} panel closed`);
				restoreFocus(restoreTo, toggle);
				restoreTo = null;
			},
		});
		disposables.push(handle);
		const open = (opts?: { modal?: boolean }): void => {
			if (dialog.open) return;
			restoreTo = deepActiveElement();
			mounter.mount(mountBody);
			handle.show(opts);
			toggle.setAttribute("aria-expanded", "true");
			announcer.announce(`${title} panel opened`);
		};
		toggle.addEventListener("click", () =>
			dialog.open ? handle.close() : open(),
		);
		dialog
			.querySelector("[data-close]")
			?.addEventListener("click", () => handle.close());
		return { dialog, toggle, open, close: () => handle.close() };
	}

	const metrics = wirePanel(
		"panel-metrics",
		"toggle-metrics",
		"mount-metrics",
		"Metrics",
		(container) => {
			container.innerHTML = `
				<label for="m-threshold">Alert threshold (ms)</label>
				<input id="m-threshold" type="number" value="2500" aria-describedby="m-threshold-hint" />
				<p id="m-threshold-hint">Announces when the metric exceeds this value.</p>
				<button type="button" id="m-refresh">Refresh now</button>
			`;
			return () => {};
		},
	);

	const feedback = wirePanel(
		"panel-feedback",
		"toggle-feedback",
		"mount-feedback",
		"Feedback",
		(container) => {
			container.innerHTML = `
				<label for="f-note">Your feedback</label>
				<textarea id="f-note" rows="3"></textarea>
				<button type="button" id="f-send">Send feedback</button>
			`;
			return undefined;
		},
	);

	return {
		host,
		shadowRoot: root.shadowRoot,
		strip,
		metrics,
		feedback,
		dispose(): void {
			metrics.close();
			feedback.close();
			for (const d of disposables.reverse()) d.dispose();
			host.remove();
		},
	};
}
