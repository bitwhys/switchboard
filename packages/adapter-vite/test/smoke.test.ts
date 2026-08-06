import { expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index";

it("exposes the package name", () => {
	expect(PACKAGE_NAME).toBe("@switchboard-dev/adapter-vite");
});
