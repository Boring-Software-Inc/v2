import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

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

const countSchema = z.number().refine(Number.isInteger).nonnegative();
const baselineSchema = z.strictObject({
	"no-arbitrary-tailwind-values": countSchema,
	"no-direct-implementation-imports": countSchema,
	"no-inline-visual-styles": countSchema,
	"no-raw-color": countSchema,
	"no-raw-spacing": countSchema,
	"no-raw-typography": countSchema,
});
const outputSchema = z.object({
	diagnostics: z.array(z.object({ code: z.string() })),
});

function emptyCounts(): RuleCounts {
	return {
		"no-arbitrary-tailwind-values": 0,
		"no-direct-implementation-imports": 0,
		"no-inline-visual-styles": 0,
		"no-raw-color": 0,
		"no-raw-spacing": 0,
		"no-raw-typography": 0,
	};
}

function parseBaseline(value: Parameters<typeof baselineSchema.safeParse>[0]) {
	const parsed = baselineSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	if (
		parsed.error.issues.some(
			(issue) => issue.code === "invalid_type" && issue.path.length === 0,
		)
	) {
		throw new Error(`${BASELINE_PATH} must contain an object.`);
	}
	const unexpected = parsed.error.issues.find(
		(issue) => issue.code === "unrecognized_keys",
	);
	if (unexpected?.code === "unrecognized_keys") {
		throw new Error(
			`${BASELINE_PATH} contains unknown rules: ${unexpected.keys.join(", ")}`,
		);
	}
	for (const rule of RULES) {
		if (parsed.error.issues.some((issue) => issue.path[0] === rule)) {
			throw new Error(
				`${BASELINE_PATH} must contain a non-negative integer for ${rule}.`,
			);
		}
	}
	throw new Error(`${BASELINE_PATH} must contain an object.`);
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

let decoded: unknown;
try {
	decoded = JSON.parse(result.stdout);
} catch {
	throw new Error(
		`Oxlint did not return JSON diagnostics:\n${result.stdout ?? ""}${result.stderr ?? ""}`,
	);
}
const output = outputSchema.safeParse(decoded);
if (!output.success) {
	throw new Error(
		"Oxlint JSON output did not contain a valid diagnostics array.",
	);
}

const counts = emptyCounts();
for (const diagnostic of output.data.diagnostics) {
	const match = /^design-system\(([^)]+)\)$/.exec(diagnostic.code);
	if (!match?.[1] || !RULES.includes(match[1] as Rule)) continue;
	counts[match[1] as Rule] += 1;
}

if (process.argv.includes("--update")) {
	writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, "\t")}\n`);
	console.log(`Updated ${BASELINE_PATH}: ${JSON.stringify(counts)}`);
	process.exit(0);
}

const baseline = parseBaseline(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
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
