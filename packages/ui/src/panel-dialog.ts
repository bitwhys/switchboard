// Toolbar contract §8.3 (P3 — panels are native <dialog>): open in either
// mode with one close path. Modal mode gets trapping, top layer, and Esc
// natively — the `cancel` event routes into the same close handler as every
// other route. Non-modal mode gets the initial focus and Esc handling the
// platform doesn't provide.

import type { Disposable } from "./disposable";

const FOCUSABLE =
	'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface PanelDialogOptions {
	/**
	 * The one close path (§8.3): runs exactly once per close, whatever the
	 * route — Esc in either mode, a close affordance calling `close()`, or a
	 * programmatic close. The adapter's dispose/clear/announce/restore
	 * sequence (§5.2, §8.4–§8.6) belongs here so it exists exactly once.
	 */
	onClose?: () => void;
	/** Non-modal initial focus target; defaults to the dialog's first focusable element. */
	initialFocus?: (dialog: HTMLDialogElement) => HTMLElement | null;
}

export interface PanelDialogHandle extends Disposable {
	readonly open: boolean;
	/** §8.3 — showModal() for modal, show() + supplied initial focus for non-modal. */
	show(options?: { modal?: boolean }): void;
	/** Routes through the one close path. No-op when already closed. */
	close(): void;
}

export function createPanelDialog(
	dialog: HTMLDialogElement,
	options: PanelDialogOptions = {},
): PanelDialogHandle {
	let modal = false;

	function closePath(): void {
		if (!dialog.open) return;
		dialog.close();
		options.onClose?.();
	}

	// Modal Esc arrives as `cancel`; route it into the same close path.
	const onCancel = (e: Event): void => {
		e.preventDefault();
		closePath();
	};
	// Non-modal <dialog> gets no built-in Esc handling (§8.3).
	const onKeydown = (e: KeyboardEvent): void => {
		if (e.key === "Escape" && dialog.open && !modal) {
			e.stopPropagation();
			closePath();
		}
	};
	dialog.addEventListener("cancel", onCancel);
	dialog.addEventListener("keydown", onKeydown);

	return {
		get open(): boolean {
			return dialog.open;
		},
		show({ modal: asModal = false }: { modal?: boolean } = {}): void {
			if (dialog.open) return;
			modal = asModal;
			if (asModal) {
				dialog.showModal();
			} else {
				dialog.show();
				const target =
					options.initialFocus?.(dialog) ??
					dialog.querySelector<HTMLElement>(FOCUSABLE);
				target?.focus();
			}
		},
		close: closePath,
		dispose(): void {
			dialog.removeEventListener("cancel", onCancel);
			dialog.removeEventListener("keydown", onKeydown);
		},
	};
}
