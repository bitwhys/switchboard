import { expect, it } from "vitest";
import {
	createSwitchboard,
	definePlugin,
	localStorageEngine,
	memoryEngine,
	SwitchboardError,
} from "../src/index";
import { createKernel } from "../src/kernel";

it("exposes the §2–§4 slice surface: definePlugin and SwitchboardError", () => {
	expect(typeof definePlugin).toBe("function");
	expect(typeof SwitchboardError).toBe("function");
});

it("exposes the §18 construction surface: createSwitchboard", () => {
	expect(typeof createSwitchboard).toBe("function");
});

it("exposes the §13.3 engines: localStorageEngine and memoryEngine (the engine interface is public API)", () => {
	expect(typeof localStorageEngine).toBe("function");
	expect(typeof memoryEngine).toBe("function");
});

it("kernel §18.3: structurally unusable options throw a named invalid-options error, before any kernel exists", () => {
	try {
		createKernel({ plugins: undefined as never });
		expect.unreachable("should have thrown");
	} catch (e) {
		expect(e).toBeInstanceOf(SwitchboardError);
		expect((e as SwitchboardError).code).toBe("invalid-options");
	}
});
