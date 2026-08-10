import { expect, it } from "vitest";
import { definePlugin, PACKAGE_NAME } from "../src/index";

it("exposes the package name", () => {
	expect(PACKAGE_NAME).toBe("@switchboard-dev/ui");
});

it("resolves types and values from a sibling workspace package", () => {
	expect(typeof definePlugin).toBe("function");
});
