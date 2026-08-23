#!/usr/bin/env bun
import * as p from "@clack/prompts";
import { Command } from "commander";
import { createColors } from "picocolors";
import { describeConfig, loadConfig } from "./lib/config.ts";
import { runActiveCleanup } from "./lib/interrupt.ts";
import {
	type RunOutcome,
	runScenario,
	unmetRequirement,
	writeRunReport,
} from "./lib/runner.ts";
import type { Method, Scenario } from "./lib/types.ts";
import { AXES, SCENARIOS, scenarioByName } from "./scenarios.ts";

/**
 * §11 LIVE E2E — one funnel-driven harness over every state the GitHub App can
 * produce. This is a pre-release / nightly tool: it drives REAL pull requests on
 * a sacrificial repo with real creds and a live worker/webhook. Not per-PR CI.
 *
 *   bun run test                          interactive funnel
 *   bun run test --only gate-block        headless, scriptable (clig.dev)
 *   bun run test --everything             all scriptable scenarios, summary table
 *   bun run test --list                   the scenario registry
 */

const config = loadConfig();
const NO_COLOR = Boolean(process.env.NO_COLOR);
const isTty = Boolean(process.stdout.isTTY);

type Colors = ReturnType<typeof createColors>;

function makeColors(enabled: boolean): Colors {
	return createColors(enabled && !NO_COLOR);
}

/** The scriptable subset — everything that doesn't need a human GitHub action. */
const scriptable = (): Scenario[] => SCENARIOS.filter((s) => !s.needs?.hybrid);

function renderList(c: Colors): void {
	for (const axis of AXES) {
		const rows = SCENARIOS.filter((s) => s.axis === axis.key);
		if (rows.length === 0) {
			continue;
		}
		process.stdout.write(`\n${c.bold(axis.label)}\n`);
		for (const s of rows) {
			const unmet = unmetRequirement(s, config);
			const tag = s.needs?.hybrid
				? c.yellow(" [hybrid]")
				: unmet
					? c.dim(` [skipped: ${unmet}]`)
					: "";
			process.stdout.write(
				`  ${c.cyan(s.name.padEnd(24))} ${s.summary}${tag}\n`,
			);
		}
	}
	process.stdout.write("\n");
}

function renderResult(outcome: RunOutcome, c: Colors): void {
	const head =
		outcome.status === "pass"
			? c.green("✓ pass")
			: outcome.status === "skip"
				? c.dim("· skipped")
				: outcome.status === "error"
					? c.red("✗ error")
					: c.red("✗ fail");
	process.stdout.write(`\n${head}  ${c.bold(outcome.scenario)}\n`);
	if (outcome.reason) {
		process.stdout.write(`  ${c.dim(outcome.reason)}\n`);
	}
	if (outcome.error) {
		process.stdout.write(`  ${c.red(outcome.error)}\n`);
	}
	for (const r of outcome.results) {
		const mark = r.ok ? c.green("✓") : c.red("✗");
		const line = r.ok
			? `  ${mark} ${r.label}`
			: `  ${mark} ${r.label}  ${c.dim(`expected ${r.expected}, got ${r.actual}`)}`;
		process.stdout.write(`${line}\n`);
	}
}

function renderSummary(outcomes: RunOutcome[], c: Colors): void {
	process.stdout.write(`\n${c.bold("summary")}\n`);
	for (const o of outcomes) {
		const mark =
			o.status === "pass"
				? c.green("✓")
				: o.status === "skip"
					? c.dim("·")
					: c.red("✗");
		const hint =
			o.status === "pass"
				? ""
				: c.dim(`   → bun run test --only ${o.scenario}`);
		process.stdout.write(
			`  ${mark} ${o.scenario.padEnd(24)} ${o.reason ?? o.error ?? o.status}${hint}\n`,
		);
	}
}

function makeHooks(
	interactive: boolean,
	spinner: ReturnType<typeof p.spinner> | null,
) {
	return {
		log: (message: string) => {
			if (spinner) {
				spinner.message(message);
			} else {
				process.stdout.write(`  … ${message}\n`);
			}
		},
		handoff: async (instruction: string): Promise<void> => {
			if (!interactive) {
				throw new Error(
					`hybrid scenario needs a human step ("${instruction}") — run interactively`,
				);
			}
			if (spinner) {
				spinner.stop("paused for a human step");
			}
			await p.confirm({ message: `[YOU] ${instruction} — done?` });
			if (spinner) {
				spinner.start("resuming");
			}
		},
	};
}

async function runOne(
	scenario: Scenario,
	method: Method,
	keep: () => Promise<boolean>,
	interactive: boolean,
): Promise<RunOutcome> {
	const spinner = interactive && isTty ? p.spinner() : null;
	spinner?.start(`running ${scenario.name}`);
	const startedAt = new Date();
	const outcome = await runScenario(scenario, {
		config,
		method,
		keep,
		hooks: makeHooks(interactive, spinner),
	});
	const report = writeRunReport(scenario, outcome, startedAt);
	spinner?.stop(
		`${scenario.name} — ${outcome.status}${report ? ` (report: ${report.replace(`${process.cwd()}/`, "")})` : ""}`,
	);
	if (!spinner && report) {
		process.stdout.write(
			`report: ${report.replace(`${process.cwd()}/`, "")}\n`,
		);
	}
	return outcome;
}

function exitCode(outcomes: RunOutcome[]): number {
	return outcomes.some((o) => o.status === "fail" || o.status === "error")
		? 1
		: 0;
}

async function funnel(c: Colors, keepAlways: boolean): Promise<void> {
	p.intro(c.bgCyan(c.black(" tripwire e2e ")));
	p.note(describeConfig(config), "target");

	const axis = await p.select({
		message: "what are you testing?",
		options: AXES.map((a) => ({ value: a.key, label: a.label })),
	});
	if (p.isCancel(axis)) {
		p.cancel("cancelled");
		return;
	}

	let scenario: Scenario | undefined;
	if (axis === "gate") {
		const outcome = await p.select({
			message: "which outcome?",
			options: [
				{ value: "pass", label: "pass — a clean change" },
				{ value: "block", label: "block — a rule trips" },
				{ value: "needs-review", label: "needs review — routed to a human" },
				{ value: "degraded", label: "degraded — reads fail, floor to review" },
			],
		});
		if (p.isCancel(outcome)) {
			p.cancel("cancelled");
			return;
		}
		scenario = SCENARIOS.find(
			(s) => s.axis === "gate" && s.outcome === outcome,
		);
	} else {
		const pick = await p.select({
			message: "which scenario?",
			options: SCENARIOS.filter((s) => s.axis === axis).map((s) => ({
				value: s.name,
				label: s.summary,
			})),
		});
		if (p.isCancel(pick)) {
			p.cancel("cancelled");
			return;
		}
		scenario = scenarioByName(pick);
	}
	if (!scenario) {
		p.cancel("no scenario matched");
		return;
	}

	let method: Method = "construct";
	if (scenario.outcome) {
		const chosen = await p.select({
			message: "how?",
			options: [
				{
					value: "construct",
					label: "construct it for me (build a PR that forces it)",
				},
				{
					value: "describe",
					label: "I'll describe it (I set it up; assert after)",
				},
			],
		});
		if (p.isCancel(chosen)) {
			p.cancel("cancelled");
			return;
		}
		method = chosen as Method;
	}

	const unmet = unmetRequirement(scenario, config);
	if (unmet) {
		p.cancel(`can't run ${scenario.name}: ${unmet}`);
		return;
	}

	p.note(
		[
			...scenario.plan.map((line) => `• ${line}`),
			"",
			c.dim(`expects: ${scenario.expects}`),
		].join("\n"),
		`plan — ${scenario.name}`,
	);

	const go = await p.confirm({
		message: "this opens a REAL pull request. proceed?",
	});
	if (p.isCancel(go) || !go) {
		p.cancel("nothing opened");
		return;
	}

	/**
	 * The funnel NEVER closes a PR on its own. It asks, once the result is on
	 * screen and you have had a chance to open the link. `--keep` skips the
	 * question and always keeps.
	 */
	const keep = async (): Promise<boolean> => {
		if (keepAlways) {
			return true;
		}
		const close = await p.confirm({
			message: "close the PR and delete its branch now?",
			initialValue: false,
		});
		return p.isCancel(close) ? true : !close;
	};
	const outcome = await runOne(scenario, method, keep, true);
	renderResult(outcome, c);

	const next = await p.select({
		message: "next?",
		options: [
			{ value: "again", label: "run another scenario" },
			{ value: "done", label: "done" },
		],
	});
	if (!p.isCancel(next) && next === "again") {
		await funnel(c, keepAlways);
		return;
	}
	p.outro(
		outcome.status === "pass"
			? c.green("✓ done")
			: c.red("✗ see failures above"),
	);
}

async function main(): Promise<void> {
	const program = new Command();
	program
		.name("tripwire-e2e")
		.description("live E2E harness over every GitHub App state (§11)")
		.option("--only <scenario>", "run one scenario headless")
		.option(
			"--expect <verdict>",
			"the expected gate verdict (pass|block|needs-review|degraded)",
		)
		.option("--everything", "run every scriptable scenario, print a summary")
		.option("--axis <key>", "run every scriptable scenario on one axis")
		.option(
			"--with-hybrid",
			"include human-in-the-loop scenarios (needs a TTY)",
		)
		.option("--no-input", "headless; requires --only or --everything")
		.option("--json", "machine-readable result to stdout")
		.option("--no-color", "disable colour")
		.option("--keep", "leave the PR open for inspection (no cleanup)")
		.option("--list", "list the scenario registry and exit")
		.allowExcessArguments(false);
	program.parse();
	const opts = program.opts<{
		only?: string;
		expect?: string;
		everything?: boolean;
		axis?: string;
		withHybrid?: boolean;
		input: boolean;
		json?: boolean;
		color: boolean;
		keep?: boolean;
		list?: boolean;
	}>();

	const c = makeColors(opts.color && isTty && !opts.json);

	if (opts.list) {
		renderList(c);
		return;
	}

	// Ctrl-C: run the in-flight scenario's teardown (restore the pinned config)
	// BEFORE exiting. A stuck poll won't unwind on its own, so we can't rely on
	// the scenario's finally firing — we run its registered cleanup here. The
	// interrupt KEEPS the PR: an interrupt is not an instruction to destroy the
	// evidence. A second Ctrl-C gives up waiting and exits now.
	let interrupting = false;
	process.on("SIGINT", () => {
		if (interrupting) {
			process.exit(130);
		}
		interrupting = true;
		process.stdout.write(
			"\n interrupted. restoring config — the PR stays open…\n",
		);
		void runActiveCleanup()
			.catch(() => undefined)
			.finally(() => process.exit(130));
	});

	if (opts.axis) {
		const chosen = scriptable().filter((s) => s.axis === opts.axis);
		if (chosen.length === 0) {
			process.stderr.write(`no scriptable scenarios on axis "${opts.axis}"\n`);
			process.exit(2);
		}
		const outcomes: RunOutcome[] = [];
		for (const scenario of chosen) {
			outcomes.push(
				await runOne(
					scenario,
					"construct",
					() => Promise.resolve(Boolean(opts.keep)),
					false,
				),
			);
		}
		if (opts.json) {
			process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
		} else {
			for (const o of outcomes) {
				renderResult(o, c);
			}
			renderSummary(outcomes, c);
		}
		process.exit(exitCode(outcomes));
	}

	if (opts.everything) {
		const chosen = opts.withHybrid ? SCENARIOS : scriptable();
		const outcomes: RunOutcome[] = [];
		for (const scenario of chosen) {
			outcomes.push(
				await runOne(
					scenario,
					"construct",
					() => Promise.resolve(Boolean(opts.keep)),
					false,
				),
			);
		}
		if (opts.json) {
			process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
		} else {
			for (const o of outcomes) {
				renderResult(o, c);
			}
			renderSummary(outcomes, c);
		}
		process.exit(exitCode(outcomes));
	}

	if (opts.only) {
		const scenario = scenarioByName(opts.only);
		if (!scenario) {
			process.stderr.write(`unknown scenario "${opts.only}" — try --list\n`);
			process.exit(2);
		}
		if (opts.expect && scenario.outcome && opts.expect !== scenario.outcome) {
			process.stderr.write(
				`--expect ${opts.expect} but ${scenario.name} yields ${scenario.outcome}\n`,
			);
			process.exit(2);
		}
		const outcome = await runOne(
			scenario,
			"construct",
			() => Promise.resolve(Boolean(opts.keep)),
			opts.input,
		);
		if (opts.json) {
			process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
		} else {
			renderResult(outcome, c);
		}
		process.exit(exitCode([outcome]));
	}

	if (!opts.input) {
		process.stderr.write(
			"--no-input requires --only <scenario> or --everything\n",
		);
		process.exit(2);
	}
	if (!isTty) {
		process.stderr.write(
			"no TTY — pass --only <scenario> or --everything for headless use\n",
		);
		process.exit(2);
	}

	await funnel(c, Boolean(opts.keep));
}

await main();
