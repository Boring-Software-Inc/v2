#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRule } from "@tripwire/core";
import {
	AGREEMENT_THRESHOLD,
	BUDGET_TOKENS,
	costUsd,
	DEFAULT_EVAL_MODEL,
	EST_TOKENS_PER_RUN,
	isPriced,
	PRICING_RETRIEVED,
	PROD_MODEL,
	RUNS_PER_FIXTURE,
} from "./config.ts";
import { buildContext, buildGenerate } from "./context.ts";
import { type EvalFixture, FIXTURES } from "./fixtures.ts";

const RULE_REF = "ai-review@2";
const MAX_STEPS = 12;

const useProdModel = process.argv.includes("--prod-model");
const MODEL = useProdModel
	? PROD_MODEL
	: (process.env.EVAL_MODEL ?? DEFAULT_EVAL_MODEL);

// Evals use the EVAL key so their spend attributes to the eval-key service in
// provider_costs_daily, separate from prod COGS. Falls back to the shared key.
const apiKey =
	process.env.OPENROUTER_API_KEY_EVAL ?? process.env.OPENROUTER_API_KEY;
if (!apiKey) {
	process.stderr.write(
		"OPENROUTER_API_KEY_EVAL or OPENROUTER_API_KEY is not set. Evals call the live model; set it in .env.\n",
	);
	process.exit(2);
}

const rule = getRule(RULE_REF);
if (!rule) {
	process.stderr.write(`rule ${RULE_REF} is not registered.\n`);
	process.exit(2);
}

interface RunResult {
	verdict: string;
	skipped: boolean;
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number | null;
	stepsUsed: number;
	latencyMs: number;
	backtickOk: boolean;
	cost: number;
}

function diffText(fixture: EvalFixture): string {
	return fixture.diff.map((f) => f.patch).join("\n");
}

/** A finding complies with @2 when a backticked token in its note is in the diff. */
function backtickComplies(findings: unknown, diff: string): boolean {
	if (!Array.isArray(findings) || findings.length === 0) {
		return false;
	}
	for (const f of findings) {
		const note = (f as { note?: string }).note ?? "";
		const m = /`([^`]+)`/.exec(note);
		if (m?.[1] && diff.includes(m[1])) {
			return true;
		}
	}
	return false;
}

async function runOnce(fixture: EvalFixture): Promise<RunResult> {
	if (!rule) {
		throw new Error(`rule ${RULE_REF} missing`);
	}
	const generate = buildGenerate(fixture, apiKey as string, MODEL);
	const ctx = buildContext(fixture, generate);
	const started = Date.now();
	const outcome = await rule.evaluate(ctx, { maxSteps: MAX_STEPS });
	const latencyMs = Date.now() - started;

	if (outcome.status === "skipped") {
		return {
			verdict: "skipped",
			skipped: true,
			inputTokens: 0,
			outputTokens: 0,
			cachedTokens: null,
			stepsUsed: 0,
			latencyMs,
			backtickOk: false,
			cost: 0,
		};
	}
	// The bounded trace (contracts) is the ONE definition of steps/usage — the
	// same shape persisted to run_steps and displayed on the run page.
	const ev = outcome.evidence as {
		output: { verdict: string; findings: unknown };
		trace: {
			stepsUsed: number;
			usage: { input: number; output: number; cached: number | null };
		};
	};
	const {
		input: inputTokens,
		output: outputTokens,
		cached: cachedTokens,
	} = ev.trace.usage;
	return {
		verdict: ev.output.verdict,
		skipped: false,
		inputTokens,
		outputTokens,
		cachedTokens,
		stepsUsed: ev.trace.stepsUsed,
		latencyMs,
		backtickOk: backtickComplies(ev.output.findings, diffText(fixture)),
		cost: costUsd(MODEL, {
			input: inputTokens,
			output: outputTokens,
			cached: cachedTokens ?? 0,
		}),
	};
}

function pct(values: number[], p: number): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
	);
}

async function main(): Promise<void> {
	const estTokens = FIXTURES.length * RUNS_PER_FIXTURE * EST_TOKENS_PER_RUN;
	process.stdout.write(
		`ai-review eval — model ${MODEL} (${useProdModel ? "prod-model" : "cheap"}), ${FIXTURES.length} fixtures x ${RUNS_PER_FIXTURE} runs\n`,
	);
	process.stdout.write(
		`estimated spend: ~${(estTokens / 1000).toFixed(0)}k tokens, budget cap ${(BUDGET_TOKENS / 1000).toFixed(0)}k\n`,
	);
	if (estTokens > BUDGET_TOKENS) {
		process.stderr.write("estimate exceeds budget cap. aborting.\n");
		process.exit(2);
	}
	if (!isPriced(MODEL)) {
		process.stdout.write(
			`warning: ${MODEL} is not in the pricing table, cost will read 0.\n`,
		);
	}

	const rows: {
		fixture: EvalFixture;
		runs: RunResult[];
		agreement: number;
		passed: boolean | null;
	}[] = [];
	let spentTokens = 0;

	for (const fixture of FIXTURES) {
		const runs: RunResult[] = [];
		for (let i = 0; i < RUNS_PER_FIXTURE; i++) {
			if (spentTokens > BUDGET_TOKENS) {
				process.stderr.write("budget cap hit mid-run. stopping.\n");
				break;
			}
			const r = await runOnce(fixture);
			spentTokens += r.inputTokens + r.outputTokens;
			runs.push(r);
			process.stdout.write(
				`  ${fixture.name} run ${i + 1}: ${r.verdict} (${r.stepsUsed} steps, ${r.latencyMs}ms)\n`,
			);
		}
		const target = fixture.expect;
		const agree =
			target === null
				? 0
				: runs.filter((r) => r.verdict === target).length / runs.length;
		rows.push({
			fixture,
			runs,
			agreement: agree,
			passed: target === null ? null : agree >= AGREEMENT_THRESHOLD,
		});
	}

	const clearcut = rows.filter((r) => r.fixture.expect !== null);
	const clearcutPassed = clearcut.filter((r) => r.passed).length;
	const allRuns = rows.flatMap((r) => r.runs);
	const modelRuns = allRuns.filter((r) => !r.skipped);
	const cachedRuns = modelRuns.filter((r) => r.cachedTokens !== null);
	const totalInput = modelRuns.reduce((s, r) => s + r.inputTokens, 0);
	const totalCached = cachedRuns.reduce((s, r) => s + (r.cachedTokens ?? 0), 0);
	const blockRuns = modelRuns.filter((r) => r.verdict === "block");

	const scorecard = {
		generatedAt: new Date(Date.now()).toISOString(),
		lane: "dev" as const,
		model: MODEL,
		ruleRef: RULE_REF,
		pricingRetrieved: PRICING_RETRIEVED,
		runsPerFixture: RUNS_PER_FIXTURE,
		aggregate: {
			clearcutScore: `${clearcutPassed}/${clearcut.length}`,
			clearcutPass: clearcutPassed === clearcut.length,
			estTokens,
			actualTokens: spentTokens,
			costUsd: Number(modelRuns.reduce((s, r) => s + r.cost, 0).toFixed(4)),
			cacheHitRate:
				cachedRuns.length === 0
					? "not measurable"
					: totalInput === 0
						? 0
						: Number((totalCached / totalInput).toFixed(3)),
			avgSteps: modelRuns.length
				? Number(
						(
							modelRuns.reduce((s, r) => s + r.stepsUsed, 0) / modelRuns.length
						).toFixed(1),
					)
				: 0,
			backtickCompliance: blockRuns.length
				? Number(
						(
							blockRuns.filter((r) => r.backtickOk).length / blockRuns.length
						).toFixed(2),
					)
				: null,
			latencyP50: pct(
				modelRuns.map((r) => r.latencyMs),
				0.5,
			),
			latencyP95: pct(
				modelRuns.map((r) => r.latencyMs),
				0.95,
			),
		},
		fixtures: rows.map((r) => ({
			name: r.fixture.name,
			kind: r.fixture.kind,
			expect: r.fixture.expect,
			agreement: Number(r.agreement.toFixed(2)),
			passed: r.passed,
			verdicts: r.runs.map((x) => x.verdict),
			costUsd: Number(r.runs.reduce((s, x) => s + x.cost, 0).toFixed(4)),
			avgSteps: r.runs.length
				? Number(
						(
							r.runs.reduce((s, x) => s + x.stepsUsed, 0) / r.runs.length
						).toFixed(1),
					)
				: 0,
		})),
	};

	const dir = join(import.meta.dir, "scorecards");
	mkdirSync(dir, { recursive: true });
	const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, "-");
	const path = join(dir, `${stamp}_${MODEL.split("/").pop()}.json`);
	writeFileSync(path, JSON.stringify(scorecard, null, 2));

	process.stdout.write("\nscorecard\n");
	process.stdout.write(
		`  clear-cut: ${scorecard.aggregate.clearcutScore}  ${scorecard.aggregate.clearcutPass ? "PASS" : "FAIL"}\n`,
	);
	process.stdout.write(
		`  cost: $${scorecard.aggregate.costUsd}  cache: ${scorecard.aggregate.cacheHitRate}  avg steps: ${scorecard.aggregate.avgSteps}/${MAX_STEPS}\n`,
	);
	process.stdout.write(
		`  latency p50/p95: ${scorecard.aggregate.latencyP50}/${scorecard.aggregate.latencyP95}ms  backtick: ${scorecard.aggregate.backtickCompliance}\n`,
	);
	for (const f of scorecard.fixtures) {
		const mark = f.passed === null ? "·" : f.passed ? "✓" : "✗";
		process.stdout.write(
			`  ${mark} ${f.name.padEnd(26)} ${f.verdicts.join(",")} (agree ${f.agreement})\n`,
		);
	}
	process.stdout.write(`\nwrote ${path.replace(`${process.cwd()}/`, "")}\n`);
	process.exit(scorecard.aggregate.clearcutPass ? 0 : 1);
}

await main();
