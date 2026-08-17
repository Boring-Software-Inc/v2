/**
 * Manual QA harness for the multi-forge integration. Drives the REAL surfaces —
 * live GitLab + GitHub APIs, the dev Postgres, the pure engine — in the order a
 * contribution actually travels: auth → import → reads → normalize → rules.
 *
 * Not a test suite: it needs credentials and a live database, so it never runs
 * in CI. It exists because the failures found so far (stale token, unrevived
 * repo, GitHub-only claim screen) were all integration seams that unit tests
 * cannot see.
 *
 *   bun --env-file=.env scripts/qa-forges.ts
 */
import {
	DEFAULT_WORKFLOW,
	type NormalizedEvent,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import type { RuleContext } from "@tripwire/core";
import { evaluateRule, executeWorkflow, getRule } from "@tripwire/core";
import { accountServices, createDb, repoServices } from "@tripwire/db";
import { checkAppCredentials, GithubReads } from "@tripwire/forge-github";
import {
	createGitlabAdapter,
	GitlabReads,
	listMaintainedProjects,
	refreshGitlabToken,
	signWebhookBody,
} from "@tripwire/forge-gitlab";

const results: { area: string; ok: boolean; detail: string }[] = [];

function record(area: string, ok: boolean, detail: string): void {
	results.push({ area, ok, detail });
	process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${area} — ${detail}\n`);
}

async function step<T>(
	area: string,
	fn: () => Promise<T>,
	describe: (value: T) => string,
): Promise<T | null> {
	try {
		const value = await fn();
		record(area, true, describe(value));
		return value;
	} catch (error) {
		record(area, false, error instanceof Error ? error.message : String(error));
		return null;
	}
}

const DB_URL =
	process.env.DATABASE_URL ??
	"postgres://tripwire:tripwire@localhost:5432/tripwire";
const { db, pool } = createDb(DB_URL);

// ── GitLab ───────────────────────────────────────────────────────────────────
const gitlabCreds =
	process.env.GITLAB_OAUTH_CLIENT_ID && process.env.GITLAB_OAUTH_CLIENT_SECRET
		? {
				clientId: process.env.GITLAB_OAUTH_CLIENT_ID,
				clientSecret: process.env.GITLAB_OAUTH_CLIENT_SECRET,
				...(process.env.GITLAB_OAUTH_ISSUER
					? { baseUrl: process.env.GITLAB_OAUTH_ISSUER }
					: {}),
			}
		: null;

const gitlabRows = await db.execute(
	// The QA account is whichever user linked GitLab — there is one in dev.
	(await import("drizzle-orm")).sql`
		SELECT user_id AS "userId", account_id AS "accountId"
		FROM account WHERE provider_id = 'gitlab' LIMIT 1
	`,
);
const gitlabAccount = gitlabRows.rows[0] as
	| { userId: string; accountId: string }
	| undefined;

let gitlabToken: string | null = null;
if (!gitlabAccount) {
	record("gitlab/account", false, "no linked gitlab account in dev db");
} else {
	record("gitlab/account", true, `account ${gitlabAccount.accountId}`);
	gitlabToken = await step(
		"gitlab/token-refresh",
		async () =>
			await accountServices.getFreshForgeToken(
				db,
				"gitlab",
				gitlabAccount.accountId,
				async (rt) => {
					if (!gitlabCreds) {
						throw new Error("GITLAB_OAUTH_CLIENT_ID/SECRET absent");
					}
					return await refreshGitlabToken(gitlabCreds, rt);
				},
			),
		(token) => `usable token (${token.length} chars)`,
	);
}

let gitlabProject: { fullName: string; externalId: string } | null = null;
let gitlabProjects: { fullName: string }[] | null = null;
if (gitlabToken) {
	const token = gitlabToken;
	const projects = await step(
		"gitlab/list-projects",
		async () => await listMaintainedProjects({ token }),
		(list) => `${list.length}: ${list.map((p) => p.fullName).join(", ")}`,
	);
	gitlabProject = projects?.[0] ?? null;
	gitlabProjects = projects ?? null;

	if (projects && gitlabAccount) {
		await step(
			"gitlab/import-upsert",
			async () => {
				for (const project of projects) {
					await repoServices.ensureRepo(db, {
						forge: "gitlab",
						externalId: project.externalId,
						owner: project.owner,
						name: project.name,
						fullName: project.fullName,
						private: project.private,
						installationId: gitlabAccount.accountId,
						orgId: null,
					});
				}
				return await repoServices.countUnclaimedRepos(
					db,
					"gitlab",
					gitlabAccount.accountId,
				);
			},
			(unclaimed) => `${projects.length} upserted, ${unclaimed} unclaimed`,
		);
	}
}

// Reads: the inputs every rule depends on. A null here is why rules "skip".
// The MR number is DISCOVERED — assuming !1 exists tests the harness, not the
// adapter, and reports a 404 as if the reads were broken.
if (gitlabToken && gitlabProject) {
	const token = gitlabToken;
	const project = gitlabProject;
	const reads = new GitlabReads({ tokenFor: async () => token });
	// Walk every imported project until one has a merge request — one empty repo
	// must not silently skip the entire read surface.
	let target: { fullName: string; iid: number } | null = null;
	// A public project as the last resort: the read surface (diff, commits,
	// contributor) is the input to every rule, so leaving it unexercised because
	// the dev account happens to have no MRs would hide real breakage.
	const candidates = [
		...(gitlabProjects ?? [project]),
		{ fullName: "gitlab-org/gitlab-foss" },
	];
	for (const candidate of candidates) {
		const res = await fetch(
			`https://gitlab.com/api/v4/projects/${encodeURIComponent(candidate.fullName)}/merge_requests?per_page=1&state=all`,
			{ headers: { authorization: `Bearer ${token}` } },
		);
		const list = (await res.json()) as { iid: number }[];
		if (list[0]?.iid !== undefined) {
			target = { fullName: candidate.fullName, iid: list[0].iid };
			break;
		}
	}
	const iid = target?.iid;
	const readRepo = target?.fullName ?? project.fullName;
	if (iid === undefined) {
		record(
			"gitlab/reads",
			true,
			"skipped — no imported gitlab project has a merge request",
		);
	} else {
		await step(
			"gitlab/read-commits",
			async () => await reads.getCommits(readRepo, iid),
			(commits) => `${commits.length} commits on ${readRepo}!${iid}`,
		);
		await step(
			"gitlab/read-diff",
			async () => await reads.getDiff(readRepo, iid),
			(diff) => `${diff.length} files on ${readRepo}!${iid}`,
		);
		await step(
			"gitlab/read-contributor",
			async () => await reads.getContributorProfile(readRepo, "vys69"),
			(profile) =>
				`@${profile.login} age=${profile.createdAt.slice(0, 10)} merged=${profile.mergedInRepo}`,
		);
	}
}

// Webhook: sign a body the way GitLab does, then verify + normalize it.
const gitlabSecret = process.env.GITLAB_WEBHOOK_SECRET ?? "qa-secret";
const mrBody = JSON.stringify({
	object_kind: "merge_request",
	event_type: "merge_request",
	project: {
		id: 1,
		name: "tripwire",
		path_with_namespace: "vys69/tripwire",
		web_url: "https://gitlab.com/vys69/tripwire",
	},
	user: { id: 7, username: "qa-bot", avatar_url: null },
	object_attributes: {
		iid: 1,
		action: "open",
		state: "opened",
		title: "qa: normalize check",
		description: "harness",
		source_branch: "qa",
		target_branch: "main",
		last_commit: { id: "a".repeat(40) },
		created_at: "2026-08-15T00:00:00Z",
		updated_at: "2026-08-15T00:00:00Z",
		url: "https://gitlab.com/vys69/tripwire/-/merge_requests/1",
	},
});
const adapter = createGitlabAdapter({ tokenFor: async () => "unused" });
const rawEvent = {
	deliveryId: "qa-1",
	eventName: "Merge Request Hook",
	body: mrBody,
	signature: signWebhookBody(mrBody, gitlabSecret),
};
await step(
	"gitlab/webhook-verify",
	async () => adapter.verifyWebhook(rawEvent, gitlabSecret),
	(ok) => (ok ? "signature accepted" : "REJECTED a valid signature"),
);
await step(
	"gitlab/webhook-reject-bad-secret",
	async () => !adapter.verifyWebhook(rawEvent, "wrong-secret"),
	(ok) => (ok ? "bad secret rejected" : "ACCEPTED a bad secret"),
);
const normalized = await step(
	"gitlab/webhook-normalize",
	async () => adapter.normalizeWebhook(rawEvent, new Date().toISOString()),
	(event) => (event ? `${event.kind} on ${event.repo.fullName}` : "null"),
);

// ── Rules: the engine, over a context built from a real normalized event ─────
if (normalized) {
	const context: RuleContext = {
		event: normalized as NormalizedEvent,
		now: new Date().toISOString(),
		diff: [
			{ path: "src/a.ts", status: "modified", additions: 3, deletions: 1 },
		],
		commits: [
			{
				sha: "a".repeat(40),
				message: "qa",
				authorLogin: "qa-bot",
				authoredAt: "2026-08-15T00:00:00Z",
			},
		],
		// A brand-new account with no history — should trip account-age.
		contributor: {
			login: "qa-bot",
			createdAt: new Date(Date.now() - 86_400_000).toISOString(),
			followers: 0,
			publicRepos: 0,
			profileText: null,
			mergedInRepo: 0,
			mergedElsewhere: 0,
			recentChangeRequestTimes: [],
			isOrgMember: false,
			isMaintainer: false,
		},
	};

	await step(
		"rules/account-age-fires",
		async () => {
			const rule = getRule("account-age@1");
			if (!rule) {
				throw new Error("account-age@1 missing from the registry");
			}
			return await evaluateRule(rule, context, { minDays: 30 });
		},
		(outcome) => {
			// `evaluated` alone proves nothing — a rule that ran and PASSED a
			// one-day-old account would be a silent gate failure, so assert the
			// verdict, not just that it executed.
			if (outcome.status !== "evaluated") {
				throw new Error(`skipped: ${outcome.reason}`);
			}
			if (outcome.passed) {
				throw new Error("PASSED a 1-day-old account against minDays=30");
			}
			return `flagged the young account (${JSON.stringify(outcome.evidence)})`;
		},
	);

	await step(
		"rules/default-workflow-executes",
		async () => {
			const definition = DEFAULT_WORKFLOW as WorkflowDefinition;
			return await executeWorkflow({
				definition,
				event: context.event,
				now: () => context.now,
				evaluateRuleRef: async (ref, params) => {
					const rule = getRule(ref);
					if (!rule) {
						return { status: "skipped", reason: "unknown rule" };
					}
					return await evaluateRule(rule, context, params);
				},
			});
		},
		(result) => {
			const byStatus = result.steps.reduce<Record<string, string[]>>(
				(acc, step) => {
					const key = step.status;
					acc[key] = acc[key] ?? [];
					acc[key].push(step.ruleRef ?? step.nodeId);
					return acc;
				},
				{},
			);
			// A young, historyless account must not come out clean. If every rule
			// SKIPPED, the workflow "ran" while gating nothing — the failure mode
			// worth catching here.
			const evaluated = result.steps.filter(
				(step) => step.status === "pass" || step.status === "fail",
			);
			if (evaluated.length === 0) {
				throw new Error(
					`every step skipped — nothing gated: ${JSON.stringify(byStatus)}`,
				);
			}
			return `verdict=${result.verdict} steps=${JSON.stringify(byStatus)} actions=[${result.actions.map((a) => a.action).join(", ")}]`;
		},
	);
}

// ── GitHub app ───────────────────────────────────────────────────────────────
const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
if (!(appId && privateKey)) {
	record("github/app-credentials", false, "GITHUB_APP_ID/PRIVATE_KEY absent");
} else {
	await step(
		"github/app-credentials",
		async () => await checkAppCredentials({ appId, privateKey }),
		(health) => JSON.stringify(health),
	);
}

const githubRepoRows = await db.execute(
	(await import("drizzle-orm")).sql`
		SELECT full_name AS "fullName", installation_id AS "installationId"
		FROM repos
		WHERE forge = 'github' AND installation_id <> '' AND removed_at IS NULL
		LIMIT 1
	`,
);
const githubRepo = githubRepoRows.rows[0] as
	| { fullName: string; installationId: string }
	| undefined;
if (githubRepo && appId && privateKey) {
	const { InstallationTokenCache } = await import("@tripwire/forge-github");
	const tokens = new InstallationTokenCache({ appId, privateKey });
	await step(
		"github/installation-token",
		async () => await tokens.getToken(githubRepo.installationId),
		(token) => `minted (${token.length} chars) for ${githubRepo.fullName}`,
	);
	await step(
		"github/read-repo",
		async () => {
			const reads = new GithubReads({
				tokenFor: async () => await tokens.getToken(githubRepo.installationId),
			});
			return await reads.getCommits(githubRepo.fullName, 1);
		},
		(commits) => `${commits.length} commits on #1`,
	);
}

await pool.end();

const failed = results.filter((r) => !r.ok);
process.stdout.write(
	`\n${results.length - failed.length}/${results.length} passed\n`,
);
if (failed.length > 0) {
	process.stdout.write(`failed: ${failed.map((f) => f.area).join(", ")}\n`);
}
