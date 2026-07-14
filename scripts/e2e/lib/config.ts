/**
 * §11 live-E2E harness config — the SAME env surface as `test:lifecycle`
 * (TEST_REPO / TEST_BASE / TEST_CONTRIBUTOR / TEST_MAINTAINER / …). No new
 * config surface: a contributor who can already run the lifecycle E2E can run
 * every scenario here. Two accounts are only needed for the non-exempt paths
 * (fork PR, stranger, rate-limit); scenarios that don't need them say so.
 */

export interface HarnessConfig {
	/** owner/name of the sacrificial repo. */
	repo: string;
	/** Just the `name` half of `repo`. */
	repoName: string;
	/** Base branch PRs open against; resolved from the repo default if unset. */
	base: string | null;
	/** The head branch of a hand-made PR to assert in `describe` mode. */
	existingBranch: string;
	/** Local clone directory, reused across runs. */
	workdir: string;
	/** Per-verdict poll timeout (ms). */
	timeoutMs: number;
	/** Poll interval (ms). */
	pollMs: number;
	/** The non-exempt alt account (gh username) — enables fork / stranger paths. */
	contributor: string | null;
	/** The maintainer account to restore/merge as (gh username). */
	maintainer: string | null;
	/** postgres — the DB the worker reads; required to pin rule_configs. */
	databaseUrl: string | null;
	/** The webhook API base URL — its `/healthz` is the pre-run liveness probe. */
	apiUrl: string;
}

const stripSlash = (value: string): string => value.replace(/\/$/, "");

export function loadConfig(
	env: NodeJS.ProcessEnv = process.env,
): HarnessConfig {
	const repo = env.TEST_REPO ?? "Boring-Software-Inc/scratch";
	const tmp = env.TMPDIR ? stripSlash(env.TMPDIR) : "/tmp";
	return {
		repo,
		repoName: repo.split("/")[1] ?? repo,
		base: env.TEST_BASE ?? null,
		existingBranch: env.TEST_BRANCH ?? "fix-typo",
		workdir: env.TEST_WORKDIR ?? `${tmp}/tripwire-e2e`,
		timeoutMs: Number(env.TEST_TIMEOUT_MS ?? 120_000),
		pollMs: Number(env.TEST_POLL_MS ?? 3000),
		contributor: env.TEST_CONTRIBUTOR ?? null,
		maintainer: env.TEST_MAINTAINER ?? null,
		databaseUrl: env.DATABASE_URL ?? null,
		apiUrl: stripSlash(
			env.TEST_API_URL ?? env.VITE_API_URL ?? "http://localhost:8787",
		),
	};
}

/** Human-readable one-liner for the plan header. */
export function describeConfig(config: HarnessConfig): string {
	const account = config.contributor
		? `two accounts (${config.contributor} + ${config.maintainer ?? "active"})`
		: "single account (local exemption-disable)";
	return `${config.repo} · ${account}`;
}
