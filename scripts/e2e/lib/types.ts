import type { Db } from "@tripwire/db";
import type { Asserter } from "./assert.ts";
import type { HarnessConfig } from "./config.ts";
import type { GitHub, PushTarget } from "./github.ts";
import type { RuleConfigRow } from "./rule-configs.ts";

/** The five funnel axes — the answer to "what states exist?". */
export type Axis = "gate" | "comment" | "contributor" | "edge" | "hybrid";

/** The gate outcomes a scenario can force. */
export type Outcome = "pass" | "block" | "needs-review" | "degraded";

/** How the PR under test comes to exist. */
export type Method = "construct" | "describe";

/**
 * How a scenario's actor pushes — this is what decides whether the gate even
 * fires. `direct` needs TRIPWIRE_DISABLE_EXEMPTION on the worker (local); `fork`
 * is genuinely non-exempt (works in prod); `exempt` pushes as a member and
 * asserts the run is SKIPPED.
 */
export type ActorMode = "direct" | "fork" | "exempt";

export interface ScenarioContext {
	gh: GitHub;
	config: HarnessConfig;
	/** Resolved base branch. */
	base: string;
	/** Non-null only when the scenario declared `needs.db` and a DB is configured. */
	db: Db | null;
	asserter: Asserter;
	method: Method;
	/**
	 * The non-exempt push mode for THIS environment: `fork` when a contributor
	 * account is configured (prod — genuinely non-exempt), else `direct` (local,
	 * relying on the worker's TRIPWIRE_DISABLE_EXEMPTION). Scenarios that aren't
	 * about a specific actor use this so one entry covers local and prod.
	 */
	defaultMode: ActorMode;
	/** Progress line into the live spinner/log. */
	log(message: string): void;
	/**
	 * A human-in-the-loop step: prints `[YOU: do X in GitHub, press enter]` and
	 * waits. In headless mode it throws unless `--with-hybrid` allowed it.
	 */
	handoff(instruction: string): Promise<void>;
	/** Resolve the push target for an actor mode (fork remote when available). */
	pushTarget(branch: string, mode: ActorMode): Promise<PushTarget>;
	/** The `--head` ref for `gh pr create` given the actor mode. */
	headRef(branch: string, mode: ActorMode): string;
}

export interface Scenario {
	/** kebab-case; the `--only` key and registry identity. */
	name: string;
	axis: Axis;
	/** For the gate axis — the outcome this forces. */
	outcome?: Outcome;
	/** One line for the menu and the plan header. */
	summary: string;
	/** What RUN will do, shown at CONFIRM before anything touches GitHub. */
	plan: string[];
	/** The headline expectation (what a green result proves). */
	expects: string;
	/**
	 * rule_configs to force ON for this scenario (everything else forced OFF).
	 * The runner pins these before RUN and restores the maintainer's real config
	 * on exit. Requires `needs.db`.
	 */
	enableRules?: RuleConfigRow[];
	/** Requirements the runner checks before allowing the scenario. */
	needs?: {
		/** Needs the second (non-exempt) account — fork / stranger paths. */
		contributor?: boolean;
		/** Needs DATABASE_URL to pin rule_configs. */
		db?: boolean;
		/** Distinct contributor accounts required (rate-limit / spray). */
		contributors?: number;
		/** Needs a human GitHub action mid-run. */
		hybrid?: boolean;
	};
	/** Does setup AND records assertions on `ctx.asserter`. */
	run(ctx: ScenarioContext): Promise<void>;
}
