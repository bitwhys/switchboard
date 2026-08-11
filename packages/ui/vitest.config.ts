import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Vitest Browser Mode — the test strategy (#28) mandates real-browser
// tests for the P1–P8 patterns plus the axe gate; jsdom can't exercise
// <dialog> modality, shadow-DOM focus, or live regions.
export default defineConfig({
	test: {
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{ browser: "chromium" }],
		},
	},
});
