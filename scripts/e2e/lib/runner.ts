import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type Db } from "@tripwire/db";
import { sql } from "drizzle-orm";
import { Asserter } from "./assert.ts";
import type { HarnessConfig } from "./config.ts";
import { GitHub, type PushTarget } from "./github.ts";
import { setActiveCleanup, type TeardownOptions } from "./interrupt.ts";
import { pinRules, restoreRules } from "./rule-configs.ts";
import type {
	ActorMode,
	Method,
	Outcome,
	Scenario,
	ScenarioContext,
} from "./types.ts";
import { pinWorkflows, restoreWorkflows } from "./workflow-pin.ts";

/** Why a scenario couldn't run — surfaced honestly, never a silent skip. */
export type SkipReason = string;

/** Gate outcome → the GitHub check conclusion it lands as. */
export const OUTCOME_TO_CONCLUSION: Record<Outcome, string> = {
	pass: "success",
	block: "failure",
	"needs-review": "neutral",
	degraded: "neutral",
};

export interface RunOutcome {
	scenario: string;
	status: "pass" | "fail" | "skip" | "error";
	reason?: SkipReason;
	results: Asserter["results"];
	error?: string;
}

export interface RunnerHooks {
	log(message: string): void;
	handoff(instruction: string): Promise<void>;
}

export interface RunnerOptions {
	config: HarnessConfig;
	method: Method;
	/**
	 * Asked at teardown, after the result is on screen. A function rather than a
	 * boolean so the interactive funnel can put the question AFTER you have seen
	 * the pull request; a scripted run just resolves a decision already made.
	 */
	keep: () => Promise<boolean>;
	hooks: RunnerHooks;
}

/**
 * `describe` mode: the human already set up the PR (on TEST_BRANCH). Read its
 * current tripwire check and assert it matches the expected outcome — the SAME
 * result diff as construct mode, without opening anything.
 */
async function assertExisting(
	ctx: ScenarioContext,
	outcome: Outcome,
): Promise<void> {
	const { gh, config, asserter } = ctx;
	const pr = await gh.findOpenPr(config.existingBranch);
	if (pr === null) {
		asserter.ok(
			`an open PR on ${config.existingBranch} to assert`,
			false,
			"none found — set TEST_BRANCH or open one",
		);
		return;
	}
	const head = await gh.prHead(pr);
	const check = await gh.waitForVerdict(pr, head, ctx.log);
	asserter.equals(
		"existing check conclusion",
		OUTCOME_TO_CONCLUSION[outcome],
		check.conclusion,
	);
}

/** A cheap connectivity probe so a DB outage reads clearly, not as a raw query dump. */
async function pingDb(db: Db): Promise<boolean> {
	try {
		await db.execute(sql`select 1`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Probe the webhook API's `/healthz` before opening a real PR — a down API means
 * no webhook lands, so no run. The WORKER has no HTTP surface; its silence still
 * surfaces as the "no run in 60s — worker up?" verdict timeout, so this only
 * proves the ingest half. Bounded so a hung host fails fast, not after minutes.
 */
async function pingApi(apiUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${apiUrl}/healthz`, {
			signal: AbortSignal.timeout(5000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Requirements gate — returns a reason string when a scenario can't run. */
export function unmetRequirement(
	scenario: Scenario,
	config: HarnessConfig,
): SkipReason | null {
	const needs = scenario.needs ?? {};
	if (needs.db && !config.databaseUrl) {
		return "needs DATABASE_URL (to pin rule_configs)";
	}
	if (needs.contributor && !config.contributor) {
		return "needs TEST_CONTRIBUTOR (the second, non-exempt account)";
	}
	return null;
}

/**
 * Run one scenario end-to-end: check requirements, pin rules, build the context
 * (account/fork orchestration lives in the pushTarget/headRef closures), run,
 * then ALWAYS restore rule_configs + the gh account and clean up.
 */

/**
 * Persist a per-run markdown report to .tests/workflows/<scenario>-<stamp>.md
 * (workflow-axis scenarios; harness artifacts, gitignored). One file per run —
 * the audit trail for "did each block do its ideal thing?".
 */
export function writeRunReport(
	scenario: Scenario,
	outcome: RunOutcome,
	startedAt: Date,
): string | null {
	if (scenario.axis !== "workflow") {
		return null;
	}
	const stamp = startedAt
		.toISOString()
		.replace(/[:.]/g, "-")
		.replace("T", "_")
		.slice(0, 19);
	const dir = join(process.cwd(), ".tests", "workflows");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${scenario.name}-${stamp}.md`);
	const durationMs = Date.now() - startedAt.getTime();
	const lines = [
		`# ${scenario.name}`,
		"",
		`- **status:** ${outcome.status}`,
		`- **axis:** ${scenario.axis}`,
		`- **started:** ${startedAt.toISOString()}`,
		`- **duration:** ${(durationMs / 1000).toFixed(1)}s`,
		`- **expects:** ${scenario.expects}`,
		"",
		"## plan",
		...scenario.plan.map((step) => `- ${step}`),
		"",
		"## assertions",
		...(outcome.results.length === 0
			? ["- (none recorded)"]
			: outcome.results.map(
					(r) =>
						`- ${r.ok ? "✅" : "❌"} ${r.label}${
							r.ok ? "" : ` — expected ${r.expected}, got ${r.actual}`
						}`,
				)),
	];
	if ("reason" in outcome && outcome.reason) {
		lines.push("", `## skipped`, String(outcome.reason));
	}
	if ("error" in outcome && outcome.error) {
		lines.push("", "## error", "```", String(outcome.error), "```");
	}
	writeFileSync(file, `${lines.join("\n")}\n`);
	return file;
}

export async function runScenario(
	scenario: Scenario,
	options: RunnerOptions,
): Promise<RunOutcome> {
	const { config, hooks } = options;
	const unmet = unmetRequirement(scenario, config);
	if (unmet) {
		return {
			scenario: scenario.name,
			status: "skip",
			reason: unmet,
			results: [],
		};
	}

	const asserter = new Asserter();
	const gh = new GitHub(config);
	let db: Db | null = null;
	let pool: { end(): Promise<void> } | null = null;
	let restore: (() => Promise<void>) | null = null;
	let startAccount: string | null = null;

	// Single teardown, run once, shared by the normal `finally` and a Ctrl-C
	// (via the interrupt registry) so an interrupted run still closes its PR and
	// restores the pinned config rather than leaking them on the sacrificial repo.
	let torn = false;
	const teardown = async (
		teardownOptions: TeardownOptions = { interrupted: false },
	): Promise<void> => {
		if (torn) {
			return;
		}
		torn = true;
		if (restore) {
			await restore().catch((error) =>
				hooks.log(`failed to restore rule_configs: ${String(error)}`),
			);
		}
		// An interrupt never closes anything: the artifacts are the evidence, and
		// a Ctrl-C is not an instruction to destroy them.
		const keep = teardownOptions.interrupted ? true : await options.keep();
		if (keep) {
			for (const url of gh.openedPrUrls()) {
				hooks.log(`left open for inspection: ${url}`);
			}
		} else {
			await gh.cleanup().catch(() => undefined);
		}
		if (startAccount) {
			await gh.as(startAccount).catch(() => undefined);
		}
		if (pool) {
			await pool.end().catch(() => undefined);
		}
	};
	setActiveCleanup(teardown);

	try {
		if (scenario.needs?.db && config.databaseUrl) {
			({ db, pool } = createDb(config.databaseUrl));
			const reachable = await pingDb(db);
			if (!reachable) {
				return {
					scenario: scenario.name,
					status: "error",
					results: [],
					error: `can't reach the database (DATABASE_URL) — is Postgres up? the local stack runs it in Docker; start it with \`bun run db:up\` (and the worker + webhook tunnel) before a live scenario`,
				};
			}
			if (!(await pingApi(config.apiUrl))) {
				return {
					scenario: scenario.name,
					status: "error",
					results: [],
					error: `the webhook API isn't responding at ${config.apiUrl}/healthz — start it (\`bun run dev:api\`) and point TEST_API_URL at the URL GitHub posts webhooks to. a down API means no webhook lands, so no run`,
				};
			}
		}
		startAccount = await gh.activeAccount();
		const base = await gh.resolveBase();

		if (scenario.enableRules && db) {
			const snapshot = await pinRules(db, config.repo, scenario.enableRules);
			restore = () => restoreRules(db as Db, snapshot);
			hooks.log("rule_configs pinned (will restore on exit)");
		}
		if (scenario.pinWorkflows && db) {
			const wfSnapshot = await pinWorkflows(
				db,
				config.repo,
				scenario.pinWorkflows,
			);
			const prevRestore = restore;
			restore = async () => {
				await restoreWorkflows(db as Db, wfSnapshot);
				if (prevRestore) {
					await prevRestore();
				}
			};
			hooks.log("workflow_definitions pinned (will restore on exit)");
		}

		const pushTarget = async (
			branch: string,
			mode: ActorMode,
		): Promise<PushTarget> => {
			if (mode === "fork") {
				await gh.as(config.contributor as string);
				await gh.ensureFork(config.contributor as string);
				return { remote: "fork", branch };
			}
			if (mode === "exempt" && config.maintainer) {
				await gh.as(config.maintainer);
			}
			return { remote: "origin", branch };
		};
		const headRef = (branch: string, mode: ActorMode): string =>
			mode === "fork" ? `${config.contributor}:${branch}` : branch;

		const ctx: ScenarioContext = {
			gh,
			config,
			base,
			db,
			asserter,
			method: options.method,
			defaultMode: config.contributor ? "fork" : "direct",
			log: hooks.log,
			handoff: hooks.handoff,
			pushTarget,
			headRef,
		};

		if (options.method === "describe" && scenario.outcome) {
			await assertExisting(ctx, scenario.outcome);
		} else {
			await scenario.run(ctx);
		}
		return {
			scenario: scenario.name,
			status: asserter.passed ? "pass" : "fail",
			results: asserter.results,
		};
	} catch (error) {
		return {
			scenario: scenario.name,
			status: "error",
			results: asserter.results,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await teardown();
		setActiveCleanup(null);
	}
}
