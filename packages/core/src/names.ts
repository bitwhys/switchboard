// Kernel spec §2 — Naming. The one shared validator for the name grammar
// (§2.1), plus the separate colon grammar for permissions and activation
// hints (§2.5, §12.1) and the capability declaration grammar (§10.1).

import validRange from "semver/ranges/valid.js";

const SEGMENT = /^[a-z0-9-]+$/;

/** §2.1: one or more dot-separated `[a-z0-9-]+` segments, ≤ 128 chars. */
export function isValidName(name: unknown): name is string {
	if (typeof name !== "string" || name.length === 0 || name.length > 128)
		return false;
	return name.split(".").every((seg) => SEGMENT.test(seg));
}

/**
 * §12.1: a permission string is `area:action` — exactly two kebab segments
 * in v1 — with a reserved third qualifier segment that MAY be a kebab-dot
 * name. Colons keep permissions disjoint from the name grammar (§2.5).
 */
export function isValidPermissionString(s: unknown): s is string {
	if (typeof s !== "string") return false;
	const segments = s.split(":");
	if (segments.length < 2 || segments.length > 3) return false;
	const [area, action, qualifier] = segments;
	if (!SEGMENT.test(area) || !SEGMENT.test(action)) return false;
	if (qualifier !== undefined && !isValidName(qualifier)) return false;
	return true;
}

export interface GrammarResult {
	ok: boolean;
}

/** §4.1: activation hints use the colon grammar — kebab segments joined by `:`. */
export function validateActivationHint(hint: unknown): GrammarResult {
	if (typeof hint !== "string" || hint.length === 0) return { ok: false };
	return { ok: hint.split(":").every((seg) => SEGMENT.test(seg)) };
}

// Exact semver (semver.org's canonical grammar, anchored).
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** §3.3: a plugin manifest `version` must be exact semver. */
export function isExactSemver(v: unknown): v is string {
	return typeof v === "string" && SEMVER.test(v);
}

/**
 * §10.1: split a capability entry at the version separator. `version` is
 * the raw right-hand side — an exact semver for `provides`, a range for
 * `requires` — validated by the entry-kind validators below.
 */
export function splitCapability(
	entry: unknown,
): { name: string; version?: string } | undefined {
	if (typeof entry !== "string" || entry.length === 0) return undefined;
	const at = entry.indexOf("@");
	if (at === -1) return isValidName(entry) ? { name: entry } : undefined;
	const name = entry.slice(0, at);
	const version = entry.slice(at + 1);
	if (!isValidName(name) || version.length === 0) return undefined;
	return { name, version };
}

/** §10.1: `provides` entries are `name` or `name@version` (exact semver). */
export function validateCapabilityProvides(entry: unknown): GrammarResult {
	const parts = splitCapability(entry);
	if (!parts) return { ok: false };
	return { ok: parts.version === undefined || isExactSemver(parts.version) };
}

/**
 * §10.1: `requires` entries are `name` or `name@range` (semver range,
 * node-semver grammar — the same `satisfies` vocabulary §10.3 checks with).
 */
export function validateCapabilityRequires(entry: unknown): GrammarResult {
	const parts = splitCapability(entry);
	if (!parts) return { ok: false };
	return {
		ok: parts.version === undefined || validRange(parts.version) !== null,
	};
}

/**
 * §2.4 + diagnostics §4.1: `switchboard.*` is reserved for the kernel, and
 * `kernel`, `bridge`, `host` are reserved as diagnostic sources — none may
 * be a plugin id (or, for `switchboard.*`, any plugin registration).
 */
export function isReservedPluginId(id: string): boolean {
	return (
		id === "kernel" ||
		id === "bridge" ||
		id === "host" ||
		isReservedNamespace(id)
	);
}

/** §2.4: any registration under `switchboard.*` (or `switchboard` itself) is reserved. */
export function isReservedNamespace(name: string): boolean {
	return name === "switchboard" || name.startsWith("switchboard.");
}
