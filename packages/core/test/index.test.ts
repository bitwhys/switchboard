import { expect, it } from "vitest";
import { definePlugin, SwitchboardError } from "../src/index";
import { createKernel } from "../src/kernel";

it("exposes the §2–§4 slice surface: definePlugin and SwitchboardError", () => {
	expect(typeof definePlugin).toBe("function");
	expect(typeof SwitchboardError).toBe("function");
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
