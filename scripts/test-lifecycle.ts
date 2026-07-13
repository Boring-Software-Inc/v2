#!/usr/bin/env bun
import { join } from "node:path";
import { CHECK_NAME, COMMENT_MARKER } from "@tripwire/forge-github";
import { $ } from "bun";

/**
 * §11 LIVE E2E — comment lifecycle (nightly / pre-release only, NOT per-PR CI).
 *
 * The block→pass transition is the flow that broke on a real contributor's PR
 * (dither-kit#8). The integration tests prove the logic against a fake adapter;
 * this proves GitHub accepts our calls and the THREAD ends up correct — every
 * assertion reads REAL GitHub state via `gh api`, never our DB.
 *
 * It drives one PR through three verdicts on a sacrificial repo:
 *   1. trip crypto-address (a wallet address in the diff)  ⇒ blocked
 *   2. remove the address                                  ⇒ passed  (transition)
 *   3. re-add the address                                  ⇒ blocked (transition)
 * and asserts the comment thread, the request-changes review, and the `tripwire`
 * check at each step. Idempotent: it wipes any prior lifecycle PR/branch first.
 *
 * REQUIRES (document in the README): the gh CLI authenticated with push access;
 * a running worker + a tunnel routing TEST_REPO's webhooks; and a pushing account
 * that is NOT exempt (org member / maintainer) on TEST_REPO, or nothing trips.
 * crypto-address must be enabled (it is, by default). Needs no `workflow` scope.
 *
 * NOT AUTOMATED (by design): whether the copy READS well. A human reads the
 * thread once — the script proves the mechanics, taste stays human.
 *
 *   TEST_REPO        owner/name              (default Boring-Software-Inc/scratch)
 *   TEST_BASE        base branch             (default the repo's default branch)
 *   TEST_LIFECYCLE_BRANCH  head branch       (default tripwire-lifecycle-e2e)
 *   TEST_WORKDIR     clone dir               (default $TMPDIR/tripwire-lifecycle)
 *   TEST_TIMEOUT_MS  per-verdict wait        (default 120000)
 */

const REPO = process.env.TEST_REPO ?? "Boring-Software-Inc/scratch";
const BRANCH = process.env.TEST_LIFECYCLE_BRANCH ?? "tripwire-lifecycle-e2e";
const WORKDIR =
	process.env.TEST_WORKDIR ??
	`${process.env.TMPDIR?.replace(/\/$/, "") ?? "/tmp"}/tripwire-lifecycle`;
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS ?? 120_000);
const POLL_MS = 3000;

// A checksum-valid-looking eth address (40 hex) — trips crypto-address@1.
const WALLET = "0x000000000000000000000000000000000000dEaD";

$.throws(true);

interface Comment {
	id: number;
	body: string;
	user: { login: string };
}
interface Review {
	id: number;
	state: string;
	body: string;
	user: { login: string };
}
interface CheckRun {
	status: string;
	conclusion: string | null;
	head_sha: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function fail(message: string): never {
	console.error(`\n✗ ${message}`);
	console.error(`  PR: https://github.com/${REPO}/pull/ (branch ${BRANCH})`);
	console.error("  artifacts left for inspection; re-run for a clean slate.\n");
	process.exit(1);
}

function ok(message: string): void {
	console.log(`  ✓ ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		fail(message);
	}
}

async function api<T>(path: string): Promise<T> {
	return (await $`gh api ${path} --paginate`.quiet().json()) as T;
}

async function comments(pr: number): Promise<Comment[]> {
	return api<Comment[]>(`/repos/${REPO}/issues/${pr}/comments?per_page=100`);
}
async function reviews(pr: number): Promise<Review[]> {
	return api<Review[]>(`/repos/${REPO}/pulls/${pr}/reviews?per_page=100`);
}

/** The completed `tripwire` check for a SHA, or null while it's still pending. */
async function completedCheck(sha: string): Promise<CheckRun | null> {
	const data = await api<{ check_runs: CheckRun[] }>(
		`/repos/${REPO}/commits/${sha}/check-runs?check_name=${CHECK_NAME}`,
	);
	return data.check_runs.find((r) => r.status === "completed") ?? null;
}

/** GitHub's view of the PR head — the truth to poll, not the local git SHA. */
async function prHeadSha(pr: number): Promise<string> {
	const data = await api<{ head: { sha: string } }>(
		`/repos/${REPO}/pulls/${pr}`,
	);
	return data.head.sha;
}

/** On a stall, print exactly what GitHub sees so the cause is obvious. */
async function diagnose(pr: number, expected: string): Promise<void> {
	try {
		const head = await prHeadSha(pr);
		console.error(
			`  github PR #${pr} head: ${head.slice(0, 7)} · expected: ${expected.slice(0, 7)}${head === expected ? "" : "  ← MISMATCH (push not registered?)"}`,
		);
		const checks = await api<{ check_runs: CheckRun[] }>(
			`/repos/${REPO}/commits/${head}/check-runs`,
		);
		console.error(
			checks.check_runs.length === 0
				? "  check runs on that SHA: NONE — the run never reached GitHub. check the worker logs: no forge creds (app not installed on this repo?), a 401 webhook (secret mismatch), or the tunnel isn't the app's webhook URL."
				: `  check runs on that SHA: ${checks.check_runs
						.map(
							(r) =>
								`${(r as { name?: string }).name}=${r.status}/${r.conclusion ?? "—"}`,
						)
						.join(", ")}`,
		);
		const cs = await comments(pr);
		console.error(
			`  active tripwire comments on the PR: ${cs.filter(hasMarker).length}`,
		);
	} catch (error) {
		console.error(`  (diagnostic read failed: ${String(error)})`);
	}
}

/**
 * Wait for GitHub to register the pushed SHA as the PR head AND the `tripwire`
 * check to COMPLETE on it — polling GitHub's head, never the local git SHA.
 */
async function waitForVerdict(pr: number, pushed: string): Promise<CheckRun> {
	const start = Date.now();
	while (Date.now() - start < TIMEOUT_MS) {
		if ((await prHeadSha(pr)) === pushed) {
			const run = await completedCheck(pushed);
			if (run) {
				return run;
			}
		}
		await sleep(POLL_MS);
	}
	await diagnose(pr, pushed);
	return fail(
		`no completed \`${CHECK_NAME}\` check for ${pushed.slice(0, 7)} within ${TIMEOUT_MS / 1000}s`,
	);
}

const hasMarker = (c: Comment) => c.body.includes(COMMENT_MARKER);
const isSuperseded = (c: Comment) =>
	c.body.includes("superseded — see the newer check below.");

async function git(...args: string[]): Promise<void> {
	await $`git ${args}`.cwd(WORKDIR).quiet();
}

async function pushWallet(present: boolean, message: string): Promise<string> {
	await Bun.write(
		join(WORKDIR, "WALLET.md"),
		present ? `# donate\n\n${WALLET}\n` : "# donate\n\n(removed)\n",
	);
	await git("add", "WALLET.md");
	await git("commit", "-m", message);
	await git("push", "origin", BRANCH);
	return (await $`git rev-parse HEAD`.cwd(WORKDIR).text()).trim();
}

/** Close any open lifecycle PR and delete the branch — a clean slate. */
async function cleanup(): Promise<void> {
	await $`gh pr close ${BRANCH} --repo ${REPO} --delete-branch`
		.nothrow()
		.quiet();
	await $`git push origin --delete ${BRANCH}`.cwd(WORKDIR).nothrow().quiet();
}

async function main(): Promise<void> {
	console.log(`lifecycle E2E on ${REPO} (branch ${BRANCH})`);

	// ── setup: clean slate, fresh branch off the base, open the PR ──────────────
	const clone = await $`test -d ${WORKDIR}/.git`.nothrow().quiet();
	if (clone.exitCode !== 0) {
		await $`gh repo clone ${REPO} ${WORKDIR}`.quiet();
	}
	const base =
		process.env.TEST_BASE ??
		(
			await $`gh repo view ${REPO} --json defaultBranchRef --jq .defaultBranchRef.name`.text()
		).trim();

	await $`git fetch origin ${base}`.cwd(WORKDIR).quiet();
	await cleanup();
	await git("checkout", base);
	await git("reset", "--hard", `origin/${base}`);
	await $`git branch -D ${BRANCH}`.cwd(WORKDIR).nothrow().quiet();
	await git("checkout", "-b", BRANCH);
	await Bun.write(join(WORKDIR, "LIFECYCLE.md"), "# tripwire lifecycle e2e\n");
	await git("add", "LIFECYCLE.md");

	// ── phase 1: a wallet address trips crypto-address ⇒ blocked ────────────────
	console.log("\nphase 1 — blocked");
	const sha1 = await pushWallet(true, "lifecycle: add wallet (trips crypto)");
	await $`gh pr create --repo ${REPO} --base ${base} --head ${BRANCH} --title ${"tripwire lifecycle e2e"} --body ${"automated §11 live E2E — safe to close."}`
		.nothrow()
		.quiet();
	const pr = Number(
		(
			await $`gh pr view ${BRANCH} --repo ${REPO} --json number --jq .number`.text()
		).trim(),
	);
	assert(Number.isInteger(pr), "could not open or find the lifecycle PR");
	ok(`PR #${pr} opened`);

	const check1 = await waitForVerdict(pr, sha1);
	assert(
		check1.conclusion === "failure",
		`expected the check to be failure (blocked), got ${check1.conclusion} — is the pushing account exempt (org member/maintainer), or crypto-address disabled?`,
	);
	ok("tripwire check is failure on the head SHA");

	let thread = await comments(pr);
	const active1 = thread.filter(hasMarker);
	assert(
		active1.length === 1,
		`expected exactly ONE active tripwire comment (with the marker), found ${active1.length}`,
	);
	const bot = active1[0]?.user.login as string;
	const mine = (list: Comment[]) => list.filter((c) => c.user.login === bot);
	assert(
		mine(thread).length === 1,
		`expected exactly ONE tripwire comment total, found ${mine(thread).length}`,
	);
	assert(
		active1[0]?.body.includes("**blocked**"),
		"the active comment does not read as blocked",
	);
	ok("exactly one tripwire comment, carries the marker, reads blocked");

	const review1 = (await reviews(pr)).find(
		(r) => r.user.login === bot && r.state === "CHANGES_REQUESTED",
	);
	assert(review1, "no CHANGES_REQUESTED review from the bot");
	ok("a request-changes review exists");

	// ── phase 2: remove the address ⇒ passed (transition) ───────────────────────
	console.log("\nphase 2 — passed (transition)");
	const sha2 = await pushWallet(false, "lifecycle: remove wallet address");
	const check2 = await waitForVerdict(pr, sha2);
	assert(
		check2.conclusion === "success",
		`expected the check to be success (passed), got ${check2.conclusion}`,
	);
	ok("tripwire check is success on the new SHA");

	thread = await comments(pr);
	assert(
		mine(thread).length === 2,
		`expected TWO tripwire comments after the transition, found ${mine(thread).length}`,
	);
	const active2 = thread.filter(hasMarker);
	assert(
		active2.length === 1,
		`expected exactly ONE active comment, found ${active2.length}`,
	);
	const newest = mine(thread).at(-1) as Comment;
	assert(
		hasMarker(newest) && newest.body.includes("**passed**"),
		"the newest comment is not the passed resolution",
	);
	assert(
		newest.body.includes("that's cleared"),
		"the resolution copy doesn't acknowledge the change",
	);
	const oldest = mine(thread)[0] as Comment;
	assert(
		isSuperseded(oldest) && !hasMarker(oldest),
		"the first (blocked) comment is not struck/superseded, or still carries the marker",
	);
	ok(
		"old comment superseded (marker-less); new comment is a passed resolution",
	);

	const review1After = (await reviews(pr)).find((r) => r.id === review1?.id);
	assert(
		review1After?.state === "DISMISSED",
		`the request-changes review was not dismissed (state ${review1After?.state})`,
	);
	ok("the stale request-changes review is dismissed");

	// ── phase 3: re-add the address ⇒ blocked (transition) ──────────────────────
	console.log("\nphase 3 — blocked again (transition)");
	const sha3 = await pushWallet(true, "lifecycle: re-add wallet address");
	const check3 = await waitForVerdict(pr, sha3);
	assert(
		check3.conclusion === "failure",
		`expected the check to be failure again, got ${check3.conclusion}`,
	);
	ok("tripwire check is failure on the newest SHA");

	thread = await comments(pr);
	assert(
		mine(thread).length === 3,
		`expected THREE tripwire comments, found ${mine(thread).length}`,
	);
	const newest3 = mine(thread).at(-1) as Comment;
	assert(
		hasMarker(newest3) && newest3.body.includes("**blocked**"),
		"the newest comment is not a fresh blocked comment",
	);
	const passedComment = mine(thread)[1] as Comment;
	assert(
		isSuperseded(passedComment) && !hasMarker(passedComment),
		"the passed comment was not superseded on the re-block",
	);
	const review3 = (await reviews(pr)).find(
		(r) =>
			r.user.login === bot &&
			r.state === "CHANGES_REQUESTED" &&
			r.id !== review1?.id,
	);
	assert(review3, "no NEW request-changes review on the re-block");
	ok("three comments; a fresh blocked comment is last; a new review exists");

	// ── cleanup (success only — failures leave artifacts to inspect) ────────────
	await cleanup();
	console.log(
		"\n✓ lifecycle E2E passed — thread mechanics verified. cleaned up.",
	);
	console.log("  (a human still reads the thread once — taste stays human.)");
}

await main();
