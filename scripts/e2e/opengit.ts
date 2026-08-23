#!/usr/bin/env bun
import type { WorkflowDefinition } from "@tripwire/contracts";
import { createDb, type Db, repoServices } from "@tripwire/db";
import { Command } from "commander";
import { loadConfig } from "./lib/config.ts";
import { loadOpenGitConfig, OpenGit } from "./lib/opengit.ts";
import { pinWorkflows, restoreWorkflows } from "./lib/workflow-pin.ts";

/**
 * §11 LIVE E2E on open-git. The sibling of `harness.ts`, deliberately separate
 * rather than a forge flag on it: the two forges assert through different
 * surfaces. The github harness reads github state with `gh api`; open-git has
 * no read api, so every assertion here goes through the ONE endpoint it does
 * expose — `GET /commits/{sha}/checks` — which is also its entire merge gate.
 *
 *   bun run scripts/e2e/opengit.ts --list
 *   bun run scripts/e2e/opengit.ts --only english-only-block
 *   bun run scripts/e2e/opengit.ts --everything
 *
 * NOTHING HERE CLOSES A PULL REQUEST. open-git has no closed-pull-request
 * surface, so a closed one cannot be inspected. Every run prints its urls and
 * leaves them open for you.
 *
 * Only english-only runs on open-git. Every other catalog rule reads a diff, a
 * commit list or a contributor profile, and open-git's api exposes none of the
 * three — see the audit in `core/src/rules/forge-support.test.ts`. That is a
 * fact about the forge, not a gap in this harness.
 */

/** trigger → english-only@1 —fail→ block. */
function englishOnlyWorkflow(): WorkflowDefinition {
	return {
		id: "e2e-og-english-only",
		name: "e2e opengit english-only",
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: ["change-request.opened", "change-request.updated"],
				position: { x: 80, y: 160 },
			},
			{
				id: "r",
				type: "rule",
				ref: "english-only@1",
				config: { maxNonLatinRatio: 0.5 },
				position: { x: 360, y: 160 },
			},
			{
				id: "a",
				type: "action",
				action: "block",
				position: { x: 640, y: 160 },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	};
}

/** Everything injectDelivery needs, resolved once the repo row is known. */
interface InjectContext {
	apiUrl: string;
	secret: string;
	installationId: string;
	repoExternalId: string;
	author: string;
}

interface OpenGitScenario {
	name: string;
	summary: string;
	title: string;
	/** The open-git check status this title must produce. */
	expect: "success" | "failed";
}

const SCENARIOS: OpenGitScenario[] = [
	{
		name: "english-only-block",
		summary: "a non-latin title trips english-only and the check blocks merge",
		// Predominantly non-latin, so the measured ratio clears maxNonLatinRatio.
		title: "修复超时问题 添加重试逻辑",
		expect: "failed",
	},
	{
		name: "english-only-pass",
		summary: "a latin title passes and the check clears the merge gate",
		title: "fix the timeout and add retry logic",
		expect: "success",
	},
];

const log = (message: string): void => {
	process.stdout.write(`${message}\n`);
};

/**
 * A repo reaches the database through its FIRST delivery — the worker's lazy
 * upsert reads the installation id off the pull-request payload. So the repo
 * cannot be registered before a pull request exists, and the workflow cannot be
 * pinned before the repo is registered. That is the whole reason this waits
 * here rather than pinning up front.
 *
 * It doubles as the webhook probe: nothing arriving means the bot's webhook url
 * is stale or the tunnel is down, which is the failure worth naming precisely.
 */
async function waitForRepoRow(
	db: Db,
	fullName: string,
	timeoutMs: number,
): Promise<{
	id: string;
	armed: boolean;
	installationId: string | null;
} | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const repo = await repoServices.getRepoByFullName(db, fullName, "opengit");
		if (repo) {
			return repo;
		}
		await Bun.sleep(2000);
	}
	return null;
}

async function runScenario(
	og: OpenGit,
	scenario: OpenGitScenario,
	stamp: string,
	pin: () => Promise<boolean>,
	inject: InjectContext | null,
): Promise<boolean> {
	/**
	 * A fresh branch and title EVERY run. This driver never closes a pull
	 * request, so a fixed name meets its own leftover from last time — and
	 * reusing an open pull request fires no `opened`, which is the only
	 * pull-request event this bot is subscribed to.
	 *
	 * The suffix is digits and punctuation, never letters, so it cannot move
	 * english-only's verdict: the rule measures non-latin over LETTERS examined.
	 */
	const branch = `tw-og-e2e-${scenario.name}-${stamp}`;
	const title = `${scenario.title} #${stamp}`;
	log(`\n▸ ${scenario.name} — ${scenario.summary}`);

	let sha = await og.pushBranch({
		branch,
		// The change itself is irrelevant: english-only reads the TITLE, and
		// open-git serves no diff, so the content can never be part of a verdict.
		edits: { "E2E.md": `open-git e2e — ${scenario.name}\n` },
		message: `e2e: ${scenario.name}`,
	});
	const pr = await og.openPr({
		branch,
		title,
		body: "opened by the tripwire open-git e2e harness. left open on purpose.",
	});
	log(`  pull request ${pr.number}${pr.reused ? " (reused)" : ""}: ${pr.url}`);

	/**
	 * Only reached on the very first run against a repo, before any delivery has
	 * registered it. That path needs `synchronize` to re-evaluate; every later
	 * run pins up front and needs only `opened`.
	 */
	const pinnedNow = await pin();
	if (pinnedNow) {
		log("  workflow pinned late — pushing a second commit to re-evaluate");
		sha = await og.pushCommit({
			branch,
			edits: { "E2E.md": `open-git e2e — ${scenario.name} (re-run)\n` },
			message: `e2e: ${scenario.name} re-run`,
		});
	}
	if (inject) {
		const posted = await og.injectDelivery({
			apiUrl: inject.apiUrl,
			secret: inject.secret,
			event: "pull_request.opened",
			installationId: inject.installationId,
			repoExternalId: inject.repoExternalId,
			number: pr.number,
			author: inject.author,
			title,
			body: "injected by the tripwire open-git e2e harness",
			headSha: sha,
		});
		log(`  delivery injected -> http ${posted.status}`);
		if (posted.status !== 200) {
			log(`  ✗ the api refused the delivery: ${posted.text}`);
			return false;
		}
	}
	log(`  head ${sha.slice(0, 7)} — waiting for the tripwire check…`);

	const check = await og.waitForCheck(sha, (message) => log(`  … ${message}`));
	if (!check) {
		log(`  ✗ TIMEOUT — no settled tripwire check on ${sha.slice(0, 7)}`);
		log("    worker down, webhook secret wrong, or the bot is not installed");
		return false;
	}
	const ok = check.status === scenario.expect;
	log(
		`  ${ok ? "✓" : "✗"} check is ${check.status}, expected ${scenario.expect}`,
	);
	if (check.summary) {
		log(`    ${check.summary}`);
	}
	return ok;
}

async function main(): Promise<void> {
	const program = new Command()
		.name("opengit-e2e")
		.option("--only <scenario>", "run one scenario")
		.option("--everything", "run every scenario")
		.option("--list", "list the scenarios and exit")
		.option(
			"--inject",
			"post the signed delivery at the local api instead of waiting for the tunnel",
		)
		.parse();
	const opts = program.opts<{
		only?: string;
		everything?: boolean;
		list?: boolean;
		inject?: boolean;
	}>();

	if (opts.list) {
		for (const scenario of SCENARIOS) {
			log(`  ${scenario.name.padEnd(22)} ${scenario.summary}`);
		}
		return;
	}

	const base = loadConfig();
	const config = loadOpenGitConfig(base);
	if (!config) {
		process.stderr.write(
			"open-git e2e needs OPEN_GIT_TEST_REPO, OPEN_GIT_TEST_TOKEN and OPEN_GIT_TEST_USER.\n" +
				"The token is a personal access token (ugp_) with repo:write.\n",
		);
		process.exit(2);
	}
	if (!base.databaseUrl) {
		process.stderr.write(
			"open-git e2e needs DATABASE_URL — the workflow is pinned in the db.\n",
		);
		process.exit(2);
	}

	const chosen = opts.everything
		? SCENARIOS
		: SCENARIOS.filter((s) => s.name === opts.only);
	if (chosen.length === 0) {
		process.stderr.write("pass --only <scenario> or --everything\n");
		process.exit(2);
	}

	const og = new OpenGit(config);
	const { db, pool } = createDb(base.databaseUrl);
	log(`target ${config.repo} on ${config.origin} (git: ${config.gitOrigin})`);
	if (await og.isEmpty()) {
		log(
			`  ${config.repo} has no refs — writing a first commit on ${config.base}`,
		);
		await og.initialise();
	}
	await og.prepare();

	/**
	 * Pins once, the first time it is possible. Returns true only on the call
	 * that actually pinned, so the caller knows it must re-trigger evaluation —
	 * the pull request that registered the repo was judged with no workflow.
	 */
	let snapshot: Awaited<ReturnType<typeof pinWorkflows>> | null = null;

	/**
	 * Pin BEFORE the first pull request when the repo is already known. That is
	 * the difference between needing `pull_request.synchronize` and needing only
	 * `pull_request.opened` — and a bot only sends the events it is subscribed
	 * to. The late path below is the fallback for a repo nothing has registered.
	 */
	/**
	 * Arming is a deliberate human act in the product — repos land `armed: false`
	 * and the dashboard turns them on. A lazily-upserted repo is therefore never
	 * armed, and the worker logs "repo not armed — event ingested, run skipped"
	 * and produces no verdict at all. The harness arms it for the run and puts
	 * the prior value back on exit, exactly like the workflow snapshot.
	 */
	let priorArmed: { repoId: string; armed: boolean } | null = null;
	const armForRun = async (repo: {
		id: string;
		armed: boolean;
	}): Promise<void> => {
		if (repo.armed) {
			return;
		}
		priorArmed = { repoId: repo.id, armed: repo.armed };
		await repoServices.setRepoArmed(db, repo.id, true);
		log("  repo armed for this run");
	};

	let registered = await repoServices.getRepoByFullName(
		db,
		config.repo,
		"opengit",
	);
	const known = registered;
	if (known?.installationId) {
		snapshot = await pinWorkflows(
			db,
			config.repo,
			[{ definition: englishOnlyWorkflow(), enabled: true }],
			"opengit",
		);
		log(`  workflow pinned up front (installation ${known.installationId})`);
		await armForRun(known);
	} else {
		log("  repo not registered yet — the first pull request will register it");
	}

	const pin = async (): Promise<boolean> => {
		if (snapshot) {
			return false;
		}
		const repo = await waitForRepoRow(db, config.repo, base.timeoutMs);
		if (!repo) {
			throw new Error(
				`${config.repo} never reached the database. No delivery arrived — ` +
					"check the bot's webhook url points at this tunnel, and that the " +
					"bot is installed on the repo.",
			);
		}
		if (!repo.installationId) {
			throw new Error(
				`${config.repo} registered with no installation id, so no token can ` +
					"be minted and no check can be posted.",
			);
		}
		log(`  repo registered (installation ${repo.installationId})`);
		snapshot = await pinWorkflows(
			db,
			config.repo,
			[{ definition: englishOnlyWorkflow(), enabled: true }],
			"opengit",
		);
		await armForRun(repo);
		registered = await repoServices.getRepoByFullName(
			db,
			config.repo,
			"opengit",
		);
		return true;
	};

	/**
	 * Resolved lazily: the repo row may not exist until the first pull request
	 * registers it, and injection needs its external id and installation.
	 */
	const injectFor = (): InjectContext | null => {
		if (!opts.inject) {
			return null;
		}
		const secret = process.env.OPEN_GIT_BOT_WEBHOOK_SECRET;
		if (!(secret && registered?.installationId && registered.externalId)) {
			return null;
		}
		return {
			apiUrl: base.apiUrl,
			secret,
			installationId: registered.installationId,
			repoExternalId: registered.externalId,
			author: config.username,
		};
	};

	// Digits only — see the branch/title note in runScenario.
	const stamp = String(Date.now()).slice(-6);
	let failures = 0;
	try {
		for (const scenario of chosen) {
			const ok = await runScenario(og, scenario, stamp, pin, injectFor());
			if (!ok) {
				failures++;
			}
		}
	} catch (error) {
		failures++;
		log(`\n✗ ${String(error instanceof Error ? error.message : error)}`);
	} finally {
		if (snapshot) {
			await restoreWorkflows(db, snapshot).catch((error) =>
				log(`failed to restore workflows: ${String(error)}`),
			);
		}
		if (priorArmed) {
			await repoServices
				.setRepoArmed(db, priorArmed.repoId, priorArmed.armed)
				.catch((error) => log(`failed to restore armed: ${String(error)}`));
		}
		await pool.end().catch(() => undefined);
		// The whole point of the run. These stay open.
		const urls = og.openedPrUrls();
		if (urls.length > 0) {
			log("\nleft open for inspection — close them by hand when done:");
			for (const url of urls) {
				log(`  ${url}`);
			}
		}
	}
	process.exit(failures === 0 ? 0 : 1);
}

await main();
