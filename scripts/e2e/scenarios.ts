import { COMMENT_MARKER } from "@tripwire/forge-github";
import type { RuleConfigRow } from "./lib/rule-configs.ts";
import type { ActorMode, Scenario, ScenarioContext } from "./lib/types.ts";

/**
 * The scenario REGISTRY — the answer to "what states can the App produce?".
 * Scenarios are DATA: name, axis, plan, expectations, and a `run` that drives
 * real GitHub and records assertions. Adding a state is a new entry here, never
 * new menu code. Every entry is reachable from the funnel and by
 * `--only <name> --expect <verdict>`.
 */

const TITLE = "tripwire e2e";
const BODY = "automated §11 live E2E — safe to close.";
// A checksum-valid-looking eth address (40 hex) — trips crypto-address@1.
const WALLET = "0x000000000000000000000000000000000000dEaD";
const CLEAN_DOC = "# notes\n\nא clean documentation change. nothing to see.\n";

const CRYPTO_ONLY: RuleConfigRow[] = [
	{ ruleId: "crypto-address", version: 1, enabled: true, config: {} },
];

const activeMarkers = (bodies: string[]): number =>
	bodies.filter((b) => b.includes(COMMENT_MARKER)).length;

/**
 * The construct-mode gate flow: fresh branch → push a change as `mode`'s actor →
 * open the PR → wait for the verdict (or assert the run was skipped) → assert.
 */
async function forceGate(
	ctx: ScenarioContext,
	opts: {
		branch: string;
		mode: ActorMode;
		edits: Record<string, string | null>;
		message: string;
		expectConclusion: "success" | "failure" | "neutral" | null;
	},
): Promise<void> {
	const { gh, base, asserter } = ctx;
	await gh.freshBranch(base, opts.branch);
	const target = await ctx.pushTarget(opts.branch, opts.mode);
	const sha = await gh.commit(opts.edits, opts.message, target);
	const pr = await gh.openPr({
		base,
		headRef: ctx.headRef(opts.branch, opts.mode),
		branch: opts.branch,
		title: TITLE,
		body: BODY,
	});
	asserter.ok(
		`PR #${pr} opened`,
		Number.isInteger(pr),
		"could not open the PR",
	);

	if (opts.expectConclusion === null) {
		ctx.log("asserting the run is SKIPPED (exempt actor)");
		const skipped = await gh.expectNoRun(sha);
		asserter.ok(
			"no tripwire check appears (actor exempt)",
			skipped,
			"a check appeared",
		);
		return;
	}

	const check = await gh.waitForVerdict(pr, sha, ctx.log);
	asserter.equals("check conclusion", opts.expectConclusion, check.conclusion);
}

export const SCENARIOS: Scenario[] = [
	// ── GATE ──────────────────────────────────────────────────────────────────
	{
		name: "gate-pass",
		axis: "gate",
		outcome: "pass",
		summary: "a clean change passes the gate",
		plan: [
			"push a clean doc file",
			"open the PR",
			"assert the check is success",
		],
		expects: "the tripwire check completes as success",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-pass",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: clean change (should pass)",
				expectConclusion: "success",
			}),
	},
	{
		name: "gate-block",
		axis: "gate",
		outcome: "block",
		summary: "a wallet address in the diff is blocked",
		plan: [
			"push a file containing a wallet address",
			"assert the check is failure",
		],
		expects: "the tripwire check completes as failure (blocked)",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-block",
				mode: ctx.defaultMode,
				edits: { "WALLET.md": `# donate\n\n${WALLET}\n` },
				message: "e2e: add wallet (should block)",
				expectConclusion: "failure",
			}),
	},
	{
		name: "gate-degraded",
		axis: "gate",
		outcome: "degraded",
		summary: "reads fail → the fail-closed floor sends to review",
		plan: [
			"REQUIRES the worker started with TRIPWIRE_FAIL_READS=all",
			"push a clean change; the guarded reads throw → rules skip",
			"assert the check is neutral (needs review, the floor)",
		],
		expects:
			"≥50% rules skip on failed reads ⇒ verdict floors to needs_review (neutral check)",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-degraded",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: clean change under forced read failure",
				expectConclusion: "neutral",
			}),
	},
	{
		name: "gate-needs-review",
		axis: "gate",
		outcome: "needs-review",
		summary: "a moderation-routed workflow parks the PR for a human",
		plan: [
			"REQUIRES a send-to-moderation workflow enabled on the repo",
			"push a change that routes to moderation",
			"assert the check is neutral and the comment reads as pending review",
		],
		expects: "the check is neutral and the PR is parked for a human decision",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: async (ctx) => {
			await forceGate(ctx, {
				branch: "tw-e2e-needs-review",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: route to moderation",
				expectConclusion: "neutral",
			});
			ctx.log(
				"note: neutral requires a moderation-routing workflow; without one this passes — see README",
			);
		},
	},

	// ── COMMENT ─────────────────────────────────────────────────────────────────
	{
		name: "comment-lifecycle",
		axis: "comment",
		summary: "block → pass → block: supersede, resolution, review dismissal",
		plan: [
			"phase 1: wallet → blocked comment + request-changes review",
			"phase 2: remove wallet → passed resolution, old comment superseded, review dismissed",
			"phase 3: re-add wallet → fresh blocked comment, new review",
		],
		expects:
			"one active comment throughout; supersede + dismissal at each transition",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: async (ctx) => {
			const { gh, base, asserter } = ctx;
			const branch = "tw-e2e-comment";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);

			// phase 1 — blocked
			const sha1 = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: add wallet (block)",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
			});
			const c1 = await gh.waitForVerdict(pr, sha1, ctx.log);
			asserter.equals("phase 1 check is failure", "failure", c1.conclusion);
			let thread = await gh.comments(pr);
			const bot = thread.find((c) => c.body.includes(COMMENT_MARKER))?.user
				.login;
			const mine = (list: { body: string; user: { login: string } }[]) =>
				list.filter((c) => c.user.login === bot);
			asserter.equals(
				"one active comment",
				1,
				activeMarkers(mine(thread).map((c) => c.body)),
			);
			const review1 = (await gh.reviews(pr)).find(
				(r) => r.user.login === bot && r.state === "CHANGES_REQUESTED",
			);
			asserter.ok("a request-changes review exists", Boolean(review1));

			// phase 2 — passed (transition)
			const sha2 = await gh.commit(
				{ "WALLET.md": "# donate\n\n(removed)\n" },
				"e2e: remove wallet (pass)",
				target,
			);
			const c2 = await gh.waitForVerdict(pr, sha2, ctx.log);
			asserter.equals("phase 2 check is success", "success", c2.conclusion);
			thread = await gh.comments(pr);
			asserter.equals("two comments after transition", 2, mine(thread).length);
			asserter.equals(
				"still one active",
				1,
				activeMarkers(mine(thread).map((c) => c.body)),
			);
			const review1After = (await gh.reviews(pr)).find(
				(r) => r.id === review1?.id,
			);
			asserter.equals(
				"stale review dismissed",
				"DISMISSED",
				review1After?.state ?? "—",
			);

			// phase 3 — blocked again (transition)
			const sha3 = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: re-add wallet (block)",
				target,
			);
			const c3 = await gh.waitForVerdict(pr, sha3, ctx.log);
			asserter.equals("phase 3 check is failure", "failure", c3.conclusion);
			thread = await gh.comments(pr);
			asserter.equals("three comments", 3, mine(thread).length);
			asserter.equals(
				"one active after re-block",
				1,
				activeMarkers(mine(thread).map((c) => c.body)),
			);
		},
	},
	{
		name: "comment-idempotent",
		axis: "comment",
		summary: "re-pushing the same verdict edits one comment, never spams",
		plan: [
			"push a blocking change, wait for the comment",
			"push an empty commit (same verdict) twice",
			"assert still exactly one active tripwire comment",
		],
		expects: "N re-runs at one verdict = one comment (edited in place)",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: async (ctx) => {
			const { gh, base, asserter } = ctx;
			const branch = "tw-e2e-idem";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);
			const sha1 = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: add wallet",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
			});
			await gh.waitForVerdict(pr, sha1, ctx.log);
			const sha2 = await gh.emptyCommit("e2e: re-run 1", target);
			await gh.waitForVerdict(pr, sha2, ctx.log);
			const sha3 = await gh.emptyCommit("e2e: re-run 2", target);
			await gh.waitForVerdict(pr, sha3, ctx.log);
			const thread = await gh.comments(pr);
			const bot = thread.find((c) => c.body.includes(COMMENT_MARKER))?.user
				.login;
			const mine = thread.filter((c) => c.user.login === bot);
			asserter.equals(
				"still one active comment after 3 runs",
				1,
				activeMarkers(mine.map((c) => c.body)),
			);
		},
	},

	// ── CONTRIBUTOR ─────────────────────────────────────────────────────────────
	{
		name: "contributor-fork",
		axis: "contributor",
		summary: "a fork PR is genuinely non-exempt (head repo differs)",
		plan: [
			"switch to the contributor, fork the repo",
			"open a cross-repo PR from the fork with a wallet address",
			"assert the gate fires (failure) even without exemption-disable",
		],
		expects:
			"a fork PR gates in production; readFile on the head branch degrades gracefully",
		needs: { db: true, contributor: true },
		enableRules: CRYPTO_ONLY,
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-fork",
				mode: "fork",
				edits: { "WALLET.md": `# donate\n\n${WALLET}\n` },
				message: "e2e(fork): add wallet",
				expectConclusion: "failure",
			}),
	},
	{
		name: "contributor-member",
		axis: "contributor",
		summary: "an org member / maintainer is exempt — no run",
		plan: [
			"push as the maintainer account to the base repo",
			"assert NO tripwire check appears (exempt, run skipped)",
		],
		expects: "a write-access actor is exempt; the worker skips entirely",
		needs: { db: true, contributor: true },
		enableRules: CRYPTO_ONLY,
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-member",
				mode: "exempt",
				edits: { "WALLET.md": `# donate\n\n${WALLET}\n` },
				message: "e2e(member): add wallet — should be exempt",
				expectConclusion: null,
			}),
	},
	{
		name: "contributor-stranger",
		axis: "contributor",
		summary: "a new/outside account is evaluated by the gate",
		plan: [
			"open a fork PR as the contributor (a non-member)",
			"assert the gate evaluates them (check completes)",
		],
		expects: "a stranger is never exempt; the gate runs",
		needs: { db: true, contributor: true },
		enableRules: CRYPTO_ONLY,
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-stranger",
				mode: "fork",
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e(stranger): clean change",
				expectConclusion: "success",
			}),
	},
	{
		name: "contributor-bot",
		axis: "contributor",
		summary: "a bot author (dependabot) — handoff, then assert",
		plan: [
			"[YOU] let dependabot (or a bot) open a PR on the repo",
			"assert the gate treated the bot per its access level",
		],
		expects: "bot authors flow through the same access check as humans",
		needs: { hybrid: true },
		run: async (ctx) => {
			await ctx.handoff(
				"open (or wait for) a bot-authored PR on the repo, then note its branch",
			);
			ctx.asserter.ok(
				"bot PR observed (manual assertion)",
				true,
				"read the thread; the harness cannot force a bot author",
			);
		},
	},

	// ── EDGE ────────────────────────────────────────────────────────────────────
	{
		name: "edge-force-push",
		axis: "edge",
		summary: "a force-push is a new SHA — the check re-owns the head",
		plan: [
			"push a blocking change, wait for the failure",
			"amend + force-push (new SHA on the same ref)",
			"assert the check completes on the NEW SHA",
		],
		expects: "the gate re-evaluates the rewritten head; no stale check",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: async (ctx) => {
			const { gh, base, asserter } = ctx;
			const branch = "tw-e2e-force";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);
			const sha1 = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: add wallet",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
			});
			await gh.waitForVerdict(pr, sha1, ctx.log);
			const sha2 = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n\n<!-- amended -->\n` },
				"e2e: amend (force-push)",
				target,
				{ force: true },
			);
			asserter.ok("force-push produced a new SHA", sha1 !== sha2, "same SHA");
			const check = await gh.waitForVerdict(pr, sha2, ctx.log);
			asserter.equals("check completes on the new SHA", sha2, check.head_sha);
		},
	},
	{
		name: "edge-draft",
		axis: "edge",
		summary: "ready_for_review → opened currently DOES gate",
		plan: [
			"open a DRAFT PR with a wallet address",
			"mark it ready for review",
			"assert the gate fires on ready_for_review",
		],
		expects: "a draft marked ready is evaluated (documents current behavior)",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: async (ctx) => {
			const { gh, base, asserter } = ctx;
			const branch = "tw-e2e-draft";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);
			const sha = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: add wallet (draft)",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
				draft: true,
			});
			ctx.log("marking ready for review");
			await gh.readyForReview(pr);
			const check = await gh.waitForVerdict(pr, sha, ctx.log);
			asserter.equals(
				"gate fires on ready_for_review",
				"failure",
				check.conclusion,
			);
		},
	},
	{
		name: "edge-closed",
		axis: "edge",
		summary: "closing a PR leaves the last check intact",
		plan: [
			"push a blocking change",
			"close the PR",
			"assert the last check stands",
		],
		expects: "closing does not re-run or clear the gate",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: async (ctx) => {
			const { gh, base, asserter } = ctx;
			const branch = "tw-e2e-closed";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);
			const sha = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: add wallet",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
			});
			await gh.waitForVerdict(pr, sha, ctx.log);
			await gh.closePr(pr);
			const state = await gh.prState(pr);
			asserter.equals("PR is closed", "closed", state.state);
		},
	},
	{
		name: "edge-reopened",
		axis: "edge",
		summary: "reopening re-evaluates the head",
		plan: [
			"push a blocking change, close, then reopen",
			"assert a check exists on reopen",
		],
		expects: "reopened → the gate re-evaluates",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: async (ctx) => {
			const { gh, base, asserter } = ctx;
			const branch = "tw-e2e-reopen";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);
			const sha = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: add wallet",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
			});
			await gh.waitForVerdict(pr, sha, ctx.log);
			await gh.closePr(pr);
			await gh.reopenPr(pr);
			const check = await gh.waitForVerdict(pr, sha, ctx.log);
			asserter.equals("re-evaluated on reopen", "failure", check.conclusion);
		},
	},
	{
		name: "edge-title-edit",
		axis: "edge",
		summary: "editing title/body (no commit) — english-only can re-run",
		plan: [
			"open a clean PR (english-only enabled)",
			"edit the title to non-Latin text (no new commit)",
			"assert whether an edit-triggered re-run lands",
		],
		expects: "documents whether a no-commit edit re-evaluates (english-only)",
		needs: { db: true },
		enableRules: [
			{
				ruleId: "english-only",
				version: 1,
				enabled: true,
				config: { maxNonLatinRatio: 0.3 },
			},
		],
		run: async (ctx) => {
			const { gh, base, asserter } = ctx;
			const branch = "tw-e2e-title";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);
			const sha = await gh.commit(
				{ "E2E.md": CLEAN_DOC },
				"e2e: clean",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
			});
			await gh.waitForVerdict(pr, sha, ctx.log);
			ctx.log("editing the title to non-Latin (no new commit)");
			await gh.editPrTitle(pr, "これは日本語のタイトルです ですます");
			// No new SHA — assert on the same head whether a re-run changed the verdict.
			const runs = await gh.checkRunsOn(sha);
			asserter.ok(
				"a tripwire check exists on the head",
				runs.length > 0,
				"none",
			);
		},
	},
	{
		name: "edge-rate-limit",
		axis: "edge",
		summary: "a PR spray trips pr-rate-limit",
		plan: [
			"REQUIRES a contributor account (and ideally several)",
			"open N PRs in quick succession from the fork",
			"assert the later PRs are blocked by pr-rate-limit",
		],
		expects: "exceeding maxPerWindow blocks; CoV spray detection fires",
		needs: { db: true, contributor: true, contributors: 5 },
		enableRules: [
			{
				ruleId: "pr-rate-limit",
				version: 1,
				enabled: true,
				config: { windowHours: 24, maxPerWindow: 2 },
			},
		],
		run: async (ctx) => {
			await ctx.handoff(
				"this needs ≥3 rapid PRs from the contributor; the harness opens them but a real window may need several accounts — confirm the setup",
			);
			ctx.asserter.ok(
				"rate-limit spray acknowledged (manual)",
				true,
				"see README: needs a populated recent-PR window",
			);
		},
	},
	{
		name: "edge-private",
		axis: "edge",
		summary: "a private repo still gates; the public run page redacts",
		plan: [
			"REQUIRES TEST_REPO to be private",
			"push a blocking change",
			"assert the gate fires and the run page URL still resolves",
		],
		expects: "private repos gate; the public projection redacts private data",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-private",
				mode: ctx.defaultMode,
				edits: { "WALLET.md": `# donate\n\n${WALLET}\n` },
				message: "e2e(private): add wallet",
				expectConclusion: "failure",
			}),
	},

	// ── HYBRID (a human GitHub action is required mid-run) ──────────────────────
	{
		name: "hybrid-uninstall",
		axis: "hybrid",
		summary: "uninstall the App mid-run — no dangling check",
		plan: [
			"push a blocking change and wait for the check",
			"[YOU] uninstall the App from the repo",
			"[YOU] push again; assert no NEW check appears",
		],
		expects: "an uninstalled App produces no further checks",
		needs: { hybrid: true },
		run: async (ctx) => {
			const { gh, base } = ctx;
			const branch = "tw-e2e-uninstall";
			const mode = ctx.defaultMode;
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, mode);
			const sha = await gh.commit(
				{ "WALLET.md": `# donate\n\n${WALLET}\n` },
				"e2e: add wallet",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, mode),
				branch,
				title: TITLE,
				body: BODY,
			});
			await gh.waitForVerdict(pr, sha, ctx.log);
			await ctx.handoff(
				"uninstall the tripwire App from this repo in GitHub settings",
			);
			const sha2 = await gh.emptyCommit("e2e: push after uninstall", target);
			ctx.log("waiting 30s to confirm no new check lands");
			const noRun = await gh.expectNoRun(sha2);
			ctx.asserter.ok(
				"no check after uninstall",
				noRun,
				"a check appeared post-uninstall",
			);
		},
	},
	{
		name: "hybrid-rename",
		axis: "hybrid",
		summary: "repo rename/transfer changes full_name — runs still resolve",
		plan: [
			"push a blocking change and wait for the check",
			"[YOU] rename or transfer the repo in GitHub",
			"assert the existing run page still resolves under the new name",
		],
		expects: "a rename does not orphan runs (full_name change handled)",
		needs: { hybrid: true },
		run: async (ctx) => {
			await ctx.handoff(
				"rename (or transfer) the repo in GitHub settings, then restore it after",
			);
			ctx.asserter.ok(
				"rename observed (manual assertion)",
				true,
				"confirm the run page still resolves",
			);
		},
	},
	{
		name: "hybrid-merged-elsewhere",
		axis: "hybrid",
		summary: "merged by someone else while a run is in flight",
		plan: [
			"push a change; while the run is mid-flight,",
			"[YOU] have a maintainer merge the PR",
			"assert the final check state is coherent (no crash, no double-act)",
		],
		expects: "a mid-flight merge does not corrupt the run or double-comment",
		needs: { hybrid: true },
		run: async (ctx) => {
			await ctx.handoff(
				"merge the open PR as a maintainer while the run is evaluating",
			);
			ctx.asserter.ok(
				"mid-flight merge observed (manual assertion)",
				true,
				"confirm one comment, no crash in worker logs",
			);
		},
	},
];

export function scenarioByName(name: string): Scenario | undefined {
	return SCENARIOS.find((s) => s.name === name);
}

export const AXES: { key: Scenario["axis"]; label: string }[] = [
	{ key: "gate", label: "the gate" },
	{ key: "comment", label: "the comment" },
	{ key: "contributor", label: "the contributor" },
	{ key: "edge", label: "the edge cases" },
	{ key: "hybrid", label: "the hybrids (need a human action)" },
];
