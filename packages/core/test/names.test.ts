import { describe, expect, it } from "vitest";
import {
	isValidName,
	isValidPermissionString,
	validateActivationHint,
	validateCapabilityProvides,
	validateCapabilityRequires,
} from "../src/names";

// Kernel spec §2 — Naming. One grammar covers every registerable name.

describe("kernel §2.1 the name grammar", () => {
	it("accepts one or more dot-separated lowercase-kebab segments", () => {
		// MUST: segments match [a-z0-9-]+, joined by dots
		for (const name of [
			"metrics",
			"metrics.vitals",
			"dom.inspector",
			"a11y.audit.run",
			"perf-panel",
			"acme.perf-panel",
			"v2.snapshot-0",
		]) {
			expect(isValidName(name), name).toBe(true);
		}
	});

	it("rejects names outside the grammar", () => {
		for (const name of [
			"",
			".",
			"metrics.",
			".metrics",
			"metrics..vitals",
			"Metrics",
			"metrics_vitals",
			"metrics vitals",
			"metrics:vitals", // colon belongs to the separate colon grammar (§2.5)
			"metrics@1", // @ is only the capability version separator (§10.1)
			"métrics",
		]) {
			expect(isValidName(name), JSON.stringify(name)).toBe(false);
		}
	});

	it("rejects non-string values", () => {
		expect(isValidName(undefined)).toBe(false);
		expect(isValidName(null)).toBe(false);
		expect(isValidName(42)).toBe(false);
	});

	it("enforces the 128-character limit (MUST be ≤ 128)", () => {
		const seg = "a".repeat(63);
		const at128 = `${seg}.${seg}`; // 63 + 1 + 63 = 127… make exactly 128
		expect(at128.length).toBe(127);
		expect(isValidName(at128)).toBe(true);
		expect(isValidName("a".repeat(128))).toBe(true);
		expect(isValidName("a".repeat(129))).toBe(false);
	});
});

describe("kernel §2.5 / §12.1 the colon grammar", () => {
	it("accepts area:action permission strings — exactly two kebab segments in v1", () => {
		for (const s of [
			"bridge:commands",
			"storage:use",
			"dom:read",
			"network:observe",
		]) {
			expect(isValidPermissionString(s), s).toBe(true);
		}
	});

	it("accepts a reserved third qualifier segment, which may be a kebab-dot name", () => {
		expect(isValidPermissionString("network:observe:api.acme-corp")).toBe(true);
	});

	it("rejects malformed permission strings", () => {
		for (const s of [
			"",
			"storage",
			"storage:",
			":use",
			"storage:Use",
			"storage use",
			"storage.use", // dots are the name grammar, not permissions (§2.5: never collide)
			"a:b:c:d",
			"network:observe:api..x",
		]) {
			expect(isValidPermissionString(s), JSON.stringify(s)).toBe(false);
		}
	});

	it("permission strings and registerable names can never collide (§2.5)", () => {
		// every valid permission contains a colon, which no valid name may
		expect(isValidName("bridge:commands")).toBe(false);
		expect(isValidPermissionString("bridge.commands")).toBe(false);
	});
});

describe("kernel §4.1 activation-hint grammar", () => {
	it("accepts eager and other single colon-grammar words", () => {
		expect(validateActivationHint("eager").ok).toBe(true);
		// unknown but grammatical — tolerated at validation; the warning is the kernel's job
		expect(validateActivationHint("on-command").ok).toBe(true);
		expect(validateActivationHint("on:command").ok).toBe(true);
	});

	it("rejects hints outside the colon grammar", () => {
		for (const s of ["", "Eager", "on command", "eager:", ":eager"]) {
			expect(validateActivationHint(s).ok, JSON.stringify(s)).toBe(false);
		}
	});
});

describe("kernel §10.1 capability declaration grammar (as validated by §3.3)", () => {
	it("accepts bare names and name@version in provides (exact semver)", () => {
		expect(validateCapabilityProvides("toolbar").ok).toBe(true);
		expect(validateCapabilityProvides("toolbar@1.2.0").ok).toBe(true);
		expect(
			validateCapabilityProvides("markdown.renderer@2.0.0-beta.1").ok,
		).toBe(true);
	});

	it("rejects provides entries with a non-exact-semver version", () => {
		expect(validateCapabilityProvides("toolbar@^1").ok).toBe(false);
		expect(validateCapabilityProvides("toolbar@1").ok).toBe(false);
		expect(validateCapabilityProvides("toolbar@").ok).toBe(false);
	});

	it("accepts bare names and name@range in requires", () => {
		expect(validateCapabilityRequires("toolbar").ok).toBe(true);
		expect(validateCapabilityRequires("toolbar@^1.0.0").ok).toBe(true);
		expect(validateCapabilityRequires("markdown.renderer@>=2 <3").ok).toBe(
			true,
		);
	});

	it("rejects entries whose name part violates the name grammar", () => {
		expect(validateCapabilityProvides("Toolbar").ok).toBe(false);
		expect(validateCapabilityRequires("tool_bar@^1").ok).toBe(false);
		expect(validateCapabilityRequires("@^1").ok).toBe(false);
		expect(validateCapabilityRequires("toolbar@").ok).toBe(false);
	});
});
