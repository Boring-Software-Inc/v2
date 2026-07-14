import { createDb, type Db } from "@tripwire/db";
import { sql } from "drizzle-orm";
import { Asserter } from "./assert.ts";
import type { HarnessConfig } from "./config.ts";
import { GitHub, type PushTarget } from "./github.ts";
import { pinRules, restoreRules } from "./rule-configs.ts";
import type {
	ActorMode,
	Method,
	Outcome,
	Scenario,
	ScenarioContext,
} from "./types.ts";

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
	/** Leave the PR open + branch intact for inspection. */
	keep: boolean;
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
		if (restore) {
			await restore().catch((error) =>
				hooks.log(`failed to restore rule_configs: ${String(error)}`),
			);
		}
		if (!options.keep) {
			await gh.cleanup().catch(() => undefined);
		}
		if (startAccount) {
			await gh.as(startAccount).catch(() => undefined);
		}
		if (pool) {
			await pool.end().catch(() => undefined);
		}
	}
}
