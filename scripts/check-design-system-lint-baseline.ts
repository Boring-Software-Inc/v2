import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

interface OxlintDiagnostic {
	code: string;
}

interface OxlintOutput {
	diagnostics: OxlintDiagnostic[];
}

const BASELINE_PATH = ".design-system/design-system-lint-baseline.json";
const RULES = [
	"no-arbitrary-tailwind-values",
	"no-direct-implementation-imports",
	"no-inline-visual-styles",
	"no-raw-color",
	"no-raw-spacing",
	"no-raw-typography",
] as const;
type Rule = (typeof RULES)[number];
type RuleCounts = Record<Rule, number>;

function emptyCounts(): RuleCounts {
	return Object.fromEntries(RULES.map((rule) => [rule, 0])) as RuleCounts;
}

function parseBaseline(value: unknown): RuleCounts {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${BASELINE_PATH} must contain an object.`);
	}
	const record = value as Record<string, unknown>;
	const unexpected = Object.keys(record).filter(
		(key) => !RULES.includes(key as Rule),
	);
	if (unexpected.length > 0) {
		throw new Error(
			`${BASELINE_PATH} contains unknown rules: ${unexpected.join(", ")}`,
		);
	}
	const counts = emptyCounts();
	for (const rule of RULES) {
		const count = record[rule];
		if (!Number.isInteger(count) || (count as number) < 0) {
			throw new Error(
				`${BASELINE_PATH} must contain a non-negative integer for ${rule}.`,
			);
		}
		counts[rule] = count as number;
	}
	return counts;
}

const result = spawnSync(
	"./node_modules/.bin/oxlint",
	["apps/web/src", "--format", "json"],
	{
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		env: { ...process.env, NODE_OPTIONS: "--experimental-strip-types" },
	},
);
if (result.error) throw result.error;
if (result.status !== 0 && result.status !== 1) {
	throw new Error(
		`Oxlint failed with status ${result.status}:\n${result.stdout ?? ""}${result.stderr ?? ""}`,
	);
}

let output: OxlintOutput;
try {
	output = JSON.parse(result.stdout) as OxlintOutput;
} catch {
	throw new Error(
		`Oxlint did not return JSON diagnostics:\n${result.stdout ?? ""}${result.stderr ?? ""}`,
	);
}
if (!Array.isArray(output.diagnostics)) {
	throw new Error("Oxlint JSON output did not contain a diagnostics array.");
}

const counts = emptyCounts();
for (const diagnostic of output.diagnostics) {
	const match = /^design-system\(([^)]+)\)$/.exec(diagnostic.code);
	if (!match?.[1] || !RULES.includes(match[1] as Rule)) continue;
	counts[match[1] as Rule] += 1;
}

if (process.argv.includes("--update")) {
	writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, "\t")}\n`);
	console.log(`Updated ${BASELINE_PATH}: ${JSON.stringify(counts)}`);
	process.exit(0);
}

const baseline = parseBaseline(
	JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as unknown,
);
const regressions = RULES.filter((rule) => counts[rule] > baseline[rule]);
const stale = RULES.filter((rule) => counts[rule] < baseline[rule]);
if (regressions.length > 0) {
	for (const rule of regressions) {
		console.error(
			`${rule}: ${counts[rule]} exceeds baseline ${baseline[rule]}`,
		);
	}
	process.exit(1);
}
if (stale.length > 0) {
	for (const rule of stale) {
		console.error(
			`${rule}: ${counts[rule]} is below baseline ${baseline[rule]}`,
		);
	}
	console.error(
		"The contract improved. Run the baseline checker with --update and include the smaller baseline.",
	);
	process.exit(1);
}

console.log(`design-system baseline holds: ${JSON.stringify(counts)}`);
