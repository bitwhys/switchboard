import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/node.ts", "src/web.ts"],
	format: ["esm"],
	dts: true,
	fixedExtension: false,
});
