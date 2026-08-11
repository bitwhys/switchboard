#!/usr/bin/env node
// Verifies that every relative Markdown link under the given roots resolves:
// the target file exists, and any #anchor matches a heading inside it.
//
// Spec citations are load-bearing in docs/ — the architecture docs cite spec
// sections by link on almost every claim, and the specs cross-link each other.
// Renaming a heading silently breaks navigation across the whole suite, and
// nothing else in the toolchain catches it. Five such links were already dead
// before this script existed.
//
// Usage: node scripts/check-doc-links.mjs [root...]   (default: docs)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push("docs");

function markdownFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry.startsWith(".")) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
		else if (entry.endsWith(".md")) found.push(path);
	}
	return found;
}

// Blanks out fenced code so that neither headings nor links inside a code
// sample or a Mermaid diagram are treated as real. Lines are kept rather than
// dropped so that reported line numbers still match the file.
function withoutFences(source) {
	let inFence = false;
	return source.split("\n").map((line) => {
		if (line.trimStart().startsWith("```")) {
			inFence = !inFence;
			return "";
		}
		return inFence ? "" : line;
	});
}

// Mirrors GitHub's heading-slug rules: strip inline markup, lowercase, drop
// everything that is not a letter, number, space, underscore or hyphen, then
// turn each remaining space into a hyphen. Spaces are not collapsed, so a
// heading like "P3 — Panels" keeps the double hyphen its em-dash leaves behind.
function slugify(heading) {
	return heading
		.replace(/`/g, "")
		.replace(/\*\*|__/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N} _-]/gu, "")
		.replace(/ /g, "-");
}

function headingAnchors(file) {
	const counts = new Map();
	const anchors = new Set();
	for (const line of withoutFences(readFileSync(file, "utf8"))) {
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		if (!heading) continue;
		const base = slugify(heading[1]);
		const seen = counts.get(base) ?? 0;
		counts.set(base, seen + 1);
		// GitHub disambiguates repeated headings with -1, -2, …
		anchors.add(seen === 0 ? base : `${base}-${seen}`);
	}
	return anchors;
}

const anchorCache = new Map();
function anchorsFor(file) {
	if (!anchorCache.has(file)) anchorCache.set(file, headingAnchors(file));
	return anchorCache.get(file);
}

const failures = [];
let checked = 0;

for (const root of roots) {
	if (!existsSync(root)) {
		console.error(`check-doc-links: no such root: ${root}`);
		process.exit(2);
	}
	for (const file of markdownFiles(root)) {
		withoutFences(readFileSync(file, "utf8")).forEach((line, index) => {
			for (const match of line.matchAll(
				/\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
			)) {
				const link = match[1];
				if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue; // external scheme
				const hash = link.indexOf("#");
				const path = hash === -1 ? link : link.slice(0, hash);
				const anchor = hash === -1 ? "" : link.slice(hash + 1);
				const target = path === "" ? file : resolve(dirname(file), path);
				checked++;
				if (!existsSync(target)) {
					failures.push(`${file}:${index + 1}  ${link}  → no such file`);
				} else if (
					anchor &&
					!anchorsFor(target).has(decodeURIComponent(anchor))
				) {
					failures.push(`${file}:${index + 1}  ${link}  → no such heading`);
				}
			}
		});
	}
}

for (const failure of failures) console.error(failure);

if (failures.length > 0) {
	console.error(`\n${failures.length} broken of ${checked} links checked`);
	process.exit(1);
}

console.log(`check-doc-links: ${checked} links OK`);
