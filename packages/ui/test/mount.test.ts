// Toolbar contract §5.2 / §8.4 (P4) — createMountController.

import { afterEach, describe, expect, it } from "vitest";
import { createMountController } from "../src/mount";

let container: HTMLElement;

function makeContainer(): HTMLElement {
	container = document.createElement("div");
	document.body.append(container);
	return container;
}

afterEach(() => {
	container?.remove();
});

describe("createMountController", () => {
	it("§5.2 mount hands the plugin the managed container", () => {
		const mounter = createMountController(makeContainer());
		let handed: HTMLElement | undefined;
		mounter.mount((c) => {
			handed = c;
			c.append(document.createElement("p"));
			return undefined;
		});
		expect(handed).toBe(container);
		expect(mounter.mounted).toBe(true);
		expect(container.children.length).toBe(1);
	});

	it("§5.2 unmount disposes then force-clears, in that order", () => {
		const mounter = createMountController(makeContainer());
		let childrenAtDispose = -1;
		mounter.mount((c) => {
			c.append(document.createElement("p"));
			return () => {
				childrenAtDispose = container.children.length;
			};
		});
		mounter.unmount();
		expect(childrenAtDispose).toBe(1); // dispose ran before the clear
		expect(container.children.length).toBe(0);
		expect(mounter.mounted).toBe(false);
	});

	it("§5.2 accepts a kernel-style Disposable as cleanup", () => {
		const mounter = createMountController(makeContainer());
		let disposed = false;
		mounter.mount(() => ({
			dispose() {
				disposed = true;
			},
		}));
		mounter.unmount();
		expect(disposed).toBe(true);
	});

	it("§8.4 the clear runs even when dispose throws", () => {
		const mounter = createMountController(makeContainer());
		mounter.mount((c) => {
			c.append(document.createElement("p"));
			return () => {
				throw new Error("plugin dispose failed");
			};
		});
		expect(() => mounter.unmount()).toThrow("plugin dispose failed");
		expect(container.children.length).toBe(0);
		expect(mounter.mounted).toBe(false);
	});

	it("§8.4 a mount that returns nothing still clears on unmount", () => {
		const mounter = createMountController(makeContainer());
		mounter.mount((c) => {
			c.append(document.createElement("p"));
			return undefined;
		});
		mounter.unmount();
		expect(container.children.length).toBe(0);
	});

	it("§5.2 every open mounts fresh — double mount throws, unmount when unmounted is a no-op", () => {
		const mounter = createMountController(makeContainer());
		mounter.mount(() => undefined);
		expect(() => mounter.mount(() => undefined)).toThrow();
		mounter.unmount();
		expect(() => mounter.unmount()).not.toThrow();
	});
});
