#!/usr/bin/env bun
import type { WorkflowDefinition } from "@tripwire/contracts";
import { createDb } from "@tripwire/db";
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

async function runScenario(
	og: OpenGit,
	scenario: OpenGitScenario,
): Promise<boolean> {
	const branch = `tw-og-e2e-${scenario.name}`;
	log(`\n▸ ${scenario.name} — ${scenario.summary}`);

	const sha = await og.pushBranch({
		branch,
		// The change itself is irrelevant: english-only reads the TITLE, and
		// open-git serves no diff, so the content can never be part of a verdict.
		edits: { "E2E.md": `open-git e2e — ${scenario.name}\n` },
		message: `e2e: ${scenario.name}`,
	});
	const pr = await og.openPr({
		branch,
		title: scenario.title,
		body: "opened by the tripwire open-git e2e harness. left open on purpose.",
	});
	log(`  pull request ${pr.number}: ${pr.url}`);
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
		.parse();
	const opts = program.opts<{
		only?: string;
		everything?: boolean;
		list?: boolean;
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
	log(`target ${config.repo} on ${config.origin}`);
	await og.prepare();

	// Pin one workflow for the whole run and put the repo's own back afterwards.
	const snapshot = await pinWorkflows(db, config.repo, [
		{ definition: englishOnlyWorkflow(), enabled: true },
	]);

	let failures = 0;
	try {
		for (const scenario of chosen) {
			const ok = await runScenario(og, scenario);
			if (!ok) {
				failures++;
			}
		}
	} finally {
		await restoreWorkflows(db, snapshot).catch((error) =>
			log(`failed to restore workflows: ${String(error)}`),
		);
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
