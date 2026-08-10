// Kernel spec §3.3 — manifest validation. Malformed = rejected loudly,
// blocking that plugin only; unknown = tolerated with a dev-mode warning
// (§15's uniform posture).

import {
	isExactSemver,
	isReservedPluginId,
	isValidName,
	isValidPermissionString,
	validateActivationHint,
	validateCapabilityProvides,
	validateCapabilityRequires,
} from "./names";
import type { PluginDefinition } from "./plugin";

const KNOWN_FIELDS = new Set([
	"id",
	"name",
	"version",
	"description",
	"package",
	"permissions",
	"activation",
	"provides",
	"requires",
	"setup",
]);

/** Kernel spec §12.2 — the v1 permission vocabulary, exactly eight strings. */
export const KNOWN_PERMISSIONS = new Set([
	"bridge:commands",
	"bridge:context",
	"bridge:events",
	"storage:use",
	"dom:read",
	"dom:write",
	"network:observe",
	"network:request",
]);

/** Kernel spec §4.1 — the v1 activation-hint vocabulary is exactly `eager`. */
export const KNOWN_ACTIVATION_HINTS = new Set(["eager"]);

export interface ManifestWarning {
	code:
		| "unknown-manifest-field"
		| "unknown-permission"
		| "unknown-activation-hint";
	subject: string;
	message: string;
}

export type ManifestResult =
	| { ok: true; manifest: PluginDefinition; warnings: ManifestWarning[] }
	| {
			ok: false;
			code: "invalid-manifest" | "reserved-namespace";
			plugin?: string;
			subject?: string;
			message: string;
	  };

export function validateManifest(def: unknown): ManifestResult {
	if (typeof def !== "object" || def === null) {
		return {
			ok: false,
			code: "invalid-manifest",
			message: `a plugin definition must be an object, got ${def === null ? "null" : typeof def}`,
		};
	}
	const d = def as Record<string, unknown>;
	// attribute the offender when the id is at least a grammatical plugin id
	const plugin =
		typeof d.id === "string" && isValidName(d.id) ? d.id : undefined;

	const fail = (message: string, subject?: string): ManifestResult => ({
		ok: false,
		code: "invalid-manifest",
		plugin,
		subject,
		message,
	});

	for (const field of ["id", "name", "version"] as const) {
		if (typeof d[field] !== "string" || d[field] === "") {
			return fail(
				`manifest field \`${field}\` is required and must be a non-empty string`,
				field,
			);
		}
	}
	if (typeof d.setup !== "function") {
		return fail(
			"manifest field `setup` is required and must be a function",
			"setup",
		);
	}
	const id = d.id as string;
	if (!isValidName(id)) {
		return fail(
			`plugin id ${JSON.stringify(id)} violates the name grammar (§2.1)`,
			id,
		);
	}
	if (isReservedPluginId(id)) {
		return {
			ok: false,
			code: "reserved-namespace",
			subject: id,
			message: `plugin id ${JSON.stringify(id)} is reserved (§2.4, diagnostics §4.1)`,
		};
	}
	if (!isExactSemver(d.version)) {
		return fail(
			`plugin version ${JSON.stringify(d.version)} is not semver (§3.3)`,
			id,
		);
	}
	for (const field of ["description", "package"] as const) {
		if (d[field] !== undefined && typeof d[field] !== "string") {
			return fail(
				`manifest field \`${field}\` must be a string when present`,
				field,
			);
		}
	}

	const warnings: ManifestWarning[] = [];

	const stringArray = (field: string): string[] | ManifestResult => {
		const v = d[field];
		if (v === undefined) return [];
		if (!Array.isArray(v) || v.some((e) => typeof e !== "string")) {
			return fail(
				`manifest field \`${field}\` must be an array of strings`,
				field,
			);
		}
		return v as string[];
	};

	const permissions = stringArray("permissions");
	if (!Array.isArray(permissions)) return permissions;
	for (const p of permissions) {
		if (!isValidPermissionString(p)) {
			return fail(
				`permission ${JSON.stringify(p)} violates the permission grammar (§12.1)`,
				p,
			);
		}
		if (!KNOWN_PERMISSIONS.has(p)) {
			warnings.push({
				code: "unknown-permission",
				subject: p,
				message: `unknown permission ${JSON.stringify(p)} — carried verbatim, grants nothing (§12.2)`,
			});
		}
	}

	const activation = stringArray("activation");
	if (!Array.isArray(activation)) return activation;
	for (const hint of activation) {
		if (!validateActivationHint(hint).ok) {
			return fail(
				`activation hint ${JSON.stringify(hint)} violates the colon grammar (§4.1)`,
				hint,
			);
		}
		if (!KNOWN_ACTIVATION_HINTS.has(hint)) {
			warnings.push({
				code: "unknown-activation-hint",
				subject: hint,
				message: `unknown activation hint ${JSON.stringify(hint)} — behaviorally ignored (§4.1)`,
			});
		}
	}

	const provides = stringArray("provides");
	if (!Array.isArray(provides)) return provides;
	for (const entry of provides) {
		if (!validateCapabilityProvides(entry).ok) {
			return fail(
				`provides entry ${JSON.stringify(entry)} violates the capability grammar (§10.1)`,
				entry,
			);
		}
	}

	const requires = stringArray("requires");
	if (!Array.isArray(requires)) return requires;
	for (const entry of requires) {
		if (!validateCapabilityRequires(entry).ok) {
			return fail(
				`requires entry ${JSON.stringify(entry)} violates the capability grammar (§10.1)`,
				entry,
			);
		}
	}

	for (const field of Object.keys(d)) {
		if (!KNOWN_FIELDS.has(field)) {
			warnings.push({
				code: "unknown-manifest-field",
				subject: field,
				message: `unknown manifest field \`${field}\` — preserved verbatim, ignored (§3.3)`,
			});
		}
	}

	return { ok: true, manifest: d as unknown as PluginDefinition, warnings };
}
