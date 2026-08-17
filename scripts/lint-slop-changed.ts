/**
 * Anti-slop gate for CHANGED code only (§ CI). Runs the oxlint anti-slop rules
 * over the files a diff range touched, then reports ONLY violations that land on
 * added or modified lines. Legacy violations on untouched lines never block a
 * PR, so the rules gate new code without forcing cleanup of code you did not
 * write. The 471 pre-existing violations get burned down separately.
 *
 * Usage: bun run scripts/lint-slop-changed.ts [gitDiffRange]
 *   CI passes `origin/<base>...HEAD` (the PR's own commits).
 *   Local preview: pass `main` to diff the working tree against main.
 */
import { spawnSync } from "node:child_process";

const range = process.argv[2] ?? "origin/main...HEAD";

function git(args: string[]): string {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout;
}

// Map each changed TS file to the line numbers the diff added or modified.
const diff = git(["diff", "--unified=0", "--diff-filter=d", range]);
const addedLines = new Map<string, Set<number>>();
let currentFile: string | null = null;
for (const line of diff.split("\n")) {
	const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
	if (fileMatch?.[1] !== undefined) {
		const path = fileMatch[1];
		currentFile = /\.(ts|tsx)$/.test(path) ? path : null;
		if (currentFile !== null && !addedLines.has(currentFile)) {
			addedLines.set(currentFile, new Set());
		}
		continue;
	}
	const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
	if (hunk?.[1] !== undefined && currentFile !== null) {
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		const set = addedLines.get(currentFile);
		for (let index = 0; index < count; index++) {
			set?.add(start + index);
		}
	}
}

const files = [...addedLines.keys()];
if (files.length === 0) {
	console.log("No changed TS files — anti-slop gate skipped.");
	process.exit(0);
}

// The anti-slop plugin is TypeScript, so Node needs type-stripping to load it.
const oxlint = spawnSync("bunx", ["oxlint", ...files], {
	encoding: "utf8",
	shell: true,
	env: { ...process.env, NODE_OPTIONS: "--experimental-strip-types" },
});
const output = `${oxlint.stdout ?? ""}\n${oxlint.stderr ?? ""}`;

// A broken plugin/config must fail loudly — never pass by finding no matches.
if (
	output.includes("Failed to load JS plugin") ||
	output.includes("Failed to parse oxlint configuration")
) {
	console.error(output);
	process.exit(1);
}

const violations: string[] = [];
for (const line of output.split("\n")) {
	const match = line.match(/^(.+?):(\d+):\d+:/);
	if (match?.[1] === undefined || match[2] === undefined) {
		continue;
	}
	if (addedLines.get(match[1])?.has(Number(match[2]))) {
		violations.push(line.trim());
	}
}

if (violations.length === 0) {
	console.log(
		`anti-slop: ${files.length} changed file(s) clean on added lines.`,
	);
	process.exit(0);
}

console.error("anti-slop violations on changed lines:\n");
for (const violation of violations) {
	console.error(violation);
}
console.error(`\n${violations.length} violation(s) on added/modified lines.`);
process.exit(1);
