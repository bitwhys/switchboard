#!/usr/bin/env node
// Reports how the RFC 2119 requirements in docs/spec changed against a base ref.
//
// Editorial passes over the specs are the risky kind of change: rewording a
// sentence can quietly alter what it requires, and nothing else catches that.
// A real case from the tone pass (#89) — splitting one sentence moved
// "debounced" out of the MUST clause, turning an obligation into a description:
//
//   before  The page MUST send a snapshot ... — debounced so a burst yields one message.
//   after   The page MUST send a snapshot ... . Snapshots are debounced, so a burst ...
//
// This is a report, not a gate. Changing a requirement is legitimate spec work;
// the point is that the change is visible and deliberate. Pass --fail-on-change
// during a pass that is meant to be purely editorial, where any delta is a bug.
//
// Usage:
//   node scripts/check-spec-requirements.mjs [--base <ref>] [--dir <path>] [--fail-on-change]
//
// Default base is HEAD (working tree vs last commit). In CI, pass the PR's
// merge base. Requires git history for the base ref.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = argv.indexOf(name);
	return i === -1 ? fallback : argv[i + 1];
};
const BASE = opt("--base", "HEAD");
const DIR = opt("--dir", "docs/spec");
const FAIL_ON_CHANGE = argv.includes("--fail-on-change");

const RFC2119 =
	/\b(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY|REQUIRED|RECOMMENDED|OPTIONAL)\b/;

function markdownFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry.startsWith(".")) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
		else if (entry.endsWith(".md")) found.push(path);
	}
	return found.sort();
}

function atBase(path) {
	try {
		return execFileSync("git", ["show", `${BASE}:${path}`], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return ""; // new file
	}
}

// Sentences carrying an RFC 2119 keyword, outside fenced code. Tables are kept:
// the diagnostics code table states requirements in its cells.
function requirements(source) {
	const out = [];
	let inFence = false;
	for (const line of source.split("\n")) {
		if (line.trimStart().startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		for (const sentence of line.split(/(?<=[.!?])\s+/)) {
			if (RFC2119.test(sentence)) out.push(sentence.trim());
		}
	}
	return out;
}

// Strips markdown and punctuation so that re-punctuating a sentence does not
// read as a changed requirement — only a different set of words does.
const meaning = (s) =>
	s
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*`_]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

if (!existsSync(DIR)) {
	console.error(`check-spec-requirements: no such directory: ${DIR}`);
	process.exit(2);
}

let added = 0;
let removed = 0;
let reworded = 0;
const lines = [];

for (const file of markdownFiles(DIR)) {
	const before = requirements(atBase(file));
	const after = requirements(readFileSync(file, "utf8"));

	const beforeKeys = new Map();
	for (const r of before) beforeKeys.set(meaning(r), r);
	const afterKeys = new Map();
	for (const r of after) afterKeys.set(meaning(r), r);

	const gone = before.filter((r) => !afterKeys.has(meaning(r)));
	const fresh = after.filter((r) => !beforeKeys.has(meaning(r)));
	const moved = after.filter((r) => {
		const k = meaning(r);
		return beforeKeys.has(k) && beforeKeys.get(k) !== r;
	});

	const mustBefore = before.join(" ").split("MUST").length - 1;
	const mustAfter = after.join(" ").split("MUST").length - 1;
	if (!gone.length && !fresh.length && !moved.length) continue;

	lines.push(
		`\n${file}   requirements ${before.length} → ${after.length}, MUST ${mustBefore} → ${mustAfter}`,
	);
	for (const r of gone) lines.push(`  REMOVED  ${r}`);
	for (const r of fresh) lines.push(`  ADDED    ${r}`);
	for (const r of moved) lines.push(`  reworded ${r}`);
	removed += gone.length;
	added += fresh.length;
	reworded += moved.length;
}

if (lines.length) console.log(lines.join("\n"));

const changed = added + removed + reworded;
console.log(
	changed === 0
		? `\ncheck-spec-requirements: no requirement changes vs ${BASE}`
		: `\ncheck-spec-requirements vs ${BASE}: ${added} added, ${removed} removed, ${reworded} reworded`,
);
if (added || removed) {
	console.log(
		"ADDED/REMOVED change what the spec requires — confirm each was intended.",
	);
}

if (FAIL_ON_CHANGE && changed > 0) {
	console.error(
		"\n--fail-on-change: this pass was meant to be editorial, but requirements moved.",
	);
	process.exit(1);
}
