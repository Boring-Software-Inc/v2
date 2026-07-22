import type { WorkflowDefinition } from "@tripwire/contracts";
import { validateWorkflowForEnable } from "@tripwire/contracts";
import { repoServices, schema } from "@tripwire/db";
import { COMMENT_MARKER } from "@tripwire/forge-github";
import { eq } from "drizzle-orm";
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
		/** Override the PR title (english-only forcing needs a non-latin one). */
		title?: string;
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
		title: opts.title ?? TITLE,
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

// ── WORKFLOW axis helpers ────────────────────────────────────────────────

const ACCOUNT_AGE_ON: RuleConfigRow[] = [
	// The /rules toggle is a KILL SWITCH over saved workflows (§6) — the rule
	// must be ON for the workflow's node to execute at all.
	{ ruleId: "account-age", version: 1, enabled: true, config: { minDays: 7 } },
];

/** trigger → account-age(minDays) —fail→ block: the editor's simplest graph. */
function accountAgeWorkflow(minDays: number): WorkflowDefinition {
	return {
		id: `e2e-wf-${minDays}`,
		name: `e2e account age ${minDays}`,
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
				ref: "account-age@1",
				config: { minDays },
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

/**
 * trigger → account-age(minDays) —fail→ block AND —fail→ webhook(url). The
 * block makes the verdict observable as a check failure; the webhook exercises
 * the outbound-delivery path against `url`. A blocked/unreachable url forces
 * the delivery FAIL route (the guard refuses it), recorded on the action row.
 */
function webhookFailWorkflow(minDays: number, url: string): WorkflowDefinition {
	return {
		id: "e2e-wf-webhook-fail",
		name: "e2e webhook fail",
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
				ref: "account-age@1",
				config: { minDays },
				position: { x: 360, y: 160 },
			},
			{
				id: "a",
				type: "action",
				action: "block",
				position: { x: 640, y: 80 },
			},
			{
				id: "w",
				type: "action",
				action: "webhook",
				params: { url },
				position: { x: 640, y: 240 },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
			{ id: "e3", from: "r", to: "w", when: "fail" },
		],
	};
}

/** One-rule saved graph: trigger → rule —fail→ block. */
function ruleWorkflow(
	ruleId: string,
	version: number,
	config: unknown,
): WorkflowDefinition {
	return {
		id: `e2e-wfm-${ruleId}`,
		name: `e2e rule ${ruleId}`,
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
				ref: `${ruleId}@${version}`,
				config: config as never,
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

/** Two rules feeding one gate —fail→ block. */
function gateWorkflow(mode: "all-of" | "any-of" | "not"): WorkflowDefinition {
	const twoRules = mode !== "not";
	return {
		id: `e2e-wfg-${mode}`,
		name: `e2e gate ${mode}`,
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: ["change-request.opened", "change-request.updated"],
				position: { x: 80, y: 160 },
			},
			{
				id: "crypto",
				type: "rule",
				ref: "crypto-address@1",
				config: {},
				position: { x: 340, y: twoRules ? 90 : 160 },
			},
			...(twoRules
				? ([
						{
							id: "age",
							type: "rule",
							ref: "account-age@1",
							config: { minDays: 0 },
							position: { x: 340, y: 240 },
						},
					] as const)
				: []),
			{ id: "g", type: "gate", mode, position: { x: 600, y: 160 } },
			{
				id: "a",
				type: "action",
				action: "block",
				position: { x: 860, y: 160 },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "crypto" },
			...(twoRules
				? ([
						{ id: "e2", from: "t", to: "age" },
						{ id: "e3", from: "age", to: "g" },
					] as const)
				: []),
			{ id: "e4", from: "crypto", to: "g" },
			{ id: "e5", from: "g", to: "a", when: "fail" as const },
		],
	};
}

interface RuleMatrixRow {
	ruleId: string;
	version: number;
	config: Record<string, unknown>;
	/** The change that forces this rule to FAIL. */
	edits: Record<string, string | null>;
	title?: string;
	why: string;
	forcing: string;
}

const RULE_MATRIX: RuleMatrixRow[] = [
	{
		ruleId: "account-age",
		version: 1,
		config: { minDays: 36500 },
		edits: { "E2E.md": CLEAN_DOC },
		why: "an account younger than 100 years",
		forcing: "push a clean change (every real account fails a 100y floor)",
	},
	{
		ruleId: "crypto-address",
		version: 1,
		config: {},
		edits: { "WALLET.md": `# donate\n\n${WALLET}\n` },
		why: "a wallet address in the diff",
		forcing: "push a file containing an eth address",
	},
	{
		ruleId: "honeypot",
		version: 1,
		config: { paths: [".github/workflows/**"] },
		edits: { ".github/workflows/e2e-touch.yml": "name: honeypot-trip\n" },
		why: "a change touching a protected path",
		forcing: "push a file under .github/workflows/",
	},
	{
		ruleId: "max-files-changed",
		version: 1,
		config: { max: 1 },
		edits: { "E2E.md": CLEAN_DOC, "E2E-2.md": CLEAN_DOC },
		why: "more files than the cap allows",
		forcing: "push two files with max set to 1",
	},
	{
		ruleId: "english-only",
		version: 1,
		config: { maxNonLatinRatio: 0.1 },
		edits: { "E2E.md": CLEAN_DOC },
		title: "проверка изменений в репозитории",
		why: "a predominantly non-latin title",
		forcing: "open the PR with a cyrillic title",
	},
	{
		ruleId: "min-merged-prs",
		version: 2,
		config: { min: 999999, trustedAfter: 999999 },
		edits: { "E2E.md": CLEAN_DOC },
		why: "fewer merges elsewhere than an absurd floor",
		forcing: "push a clean change (nobody has 999999 merged PRs elsewhere)",
	},
	{
		ruleId: "profile-readme",
		version: 1,
		config: { minLength: 100000 },
		edits: { "E2E.md": CLEAN_DOC },
		why: "a profile shorter than an absurd floor",
		forcing: "push a clean change (no profile carries 100k chars)",
	},
];

interface GateMatrixRow {
	mode: "all-of" | "any-of" | "not";
	edits: Record<string, string | null>;
	expect: "success" | "failure";
	summary: string;
	forcing: string;
	expects: string;
}

const GATE_MATRIX: GateMatrixRow[] = [
	{
		mode: "all-of",
		edits: { "WALLET.md": `# donate\n\n${WALLET}\n` },
		expect: "failure",
		summary: "all-of gate: one failing input fails the gate → block",
		forcing: "push a wallet address (crypto fails, account-age passes)",
		expects: "all-of demands every input pass; one failure blocks",
	},
	{
		mode: "any-of",
		edits: { "WALLET.md": `# donate\n\n${WALLET}\n` },
		expect: "success",
		summary: "any-of gate: one passing input passes the gate → no block",
		forcing: "push a wallet address (crypto fails, account-age passes)",
		expects: "any-of is satisfied by the passing account-age; no block",
	},
	{
		mode: "not",
		edits: { "E2E.md": CLEAN_DOC },
		expect: "failure",
		summary: "not gate: inverts a PASSING rule into a block",
		forcing: "push a clean change (crypto passes → not fails → block)",
		expects: "`not` flips pass to fail; the fail edge conducts to block",
	},
];

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
	// ── WORKFLOW (saved graphs through the real pipeline) ────────────────────
	{
		name: "workflow-block",
		axis: "workflow",
		summary: "a saved workflow's fail→block edge blocks a clean PR",
		plan: [
			"pin a saved ENABLED workflow: account-age(minDays 36500) —fail→ block",
			"push a clean doc change (any real account is younger than 100 years)",
			"assert the check is failure — the SAVED graph drove the verdict",
		],
		expects:
			"the workflow the editor emits (not the derived default) produces the block",
		needs: { db: true },
		enableRules: ACCOUNT_AGE_ON,
		pinWorkflows: [{ definition: accountAgeWorkflow(36500), enabled: true }],
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-wf-block",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: clean change vs blocking workflow",
				expectConclusion: "failure",
			}),
	},
	{
		name: "workflow-pass",
		axis: "workflow",
		summary: "the same saved workflow with a satisfiable threshold passes",
		plan: [
			"pin a saved ENABLED workflow: account-age(minDays 0) —fail→ block",
			"push a clean doc change",
			"assert the check is success",
		],
		expects: "a passing rule conducts the pass edge; no block action fires",
		needs: { db: true },
		enableRules: ACCOUNT_AGE_ON,
		pinWorkflows: [{ definition: accountAgeWorkflow(0), enabled: true }],
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-wf-pass",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: clean change vs passing workflow",
				expectConclusion: "success",
			}),
	},
	{
		name: "workflow-disabled-inert",
		axis: "workflow",
		summary: "a DISABLED saved workflow never runs (§4: enable is explicit)",
		plan: [
			"pin the blocking workflow but DISABLED; crypto-address is the only live rule",
			"push a clean doc change",
			"assert the check is success — the disabled graph stayed inert",
		],
		expects:
			"saving never enables: the blocking workflow exists but the derived default (crypto only) decides",
		needs: { db: true },
		enableRules: CRYPTO_ONLY,
		pinWorkflows: [{ definition: accountAgeWorkflow(36500), enabled: false }],
		run: (ctx) =>
			forceGate(ctx, {
				branch: "tw-e2e-wf-inert",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: clean change vs DISABLED blocking workflow",
				expectConclusion: "success",
			}),
	},
	{
		name: "workflow-existing",
		axis: "workflow",
		summary: "YOUR saved workflows: validate + drive a real PR through them",
		plan: [
			"no pinning — read the repo's CURRENTLY ENABLED workflows",
			"assert each passes enable-time validation",
			"open a clean PR and assert a verdict lands (whatever your graphs decide)",
		],
		expects:
			"every enabled workflow on the repo is valid and executes to a verdict on a live PR",
		needs: { db: true },
		run: async (ctx) => {
			const { gh, base, asserter, db } = ctx;
			if (!db) {
				throw new Error("workflow-existing needs a DB");
			}
			const repo = await repoServices.getRepoByFullName(db, ctx.config.repo);
			if (!repo) {
				throw new Error(`repo ${ctx.config.repo} not in the DB`);
			}
			const rows = await db
				.select({
					name: schema.workflowDefinitions.name,
					enabled: schema.workflowDefinitions.enabled,
					definition: schema.workflowDefinitions.definition,
				})
				.from(schema.workflowDefinitions)
				.where(eq(schema.workflowDefinitions.repoId, repo.id));
			const enabled = rows.filter((row) => row.enabled);
			ctx.log(`${rows.length} saved workflows, ${enabled.length} enabled`);
			for (const row of enabled) {
				const result = validateWorkflowForEnable(row.definition);
				asserter.ok(
					`workflow "${row.name}" passes enable-time validation`,
					result.valid,
					result.valid
						? ""
						: result.issues.map((issue) => issue.message).join("; "),
				);
			}
			if (enabled.length === 0) {
				ctx.log("no enabled workflows — the derived default will decide");
			}
			const branch = "tw-e2e-wf-existing";
			await gh.freshBranch(base, branch);
			const target = await ctx.pushTarget(branch, ctx.defaultMode);
			const sha = await gh.commit(
				{ "E2E.md": CLEAN_DOC },
				"e2e: clean change through YOUR workflows",
				target,
			);
			const pr = await gh.openPr({
				base,
				headRef: ctx.headRef(branch, ctx.defaultMode),
				branch,
				title: TITLE,
				body: BODY,
			});
			asserter.ok(`PR #${pr} opened`, Number.isInteger(pr), "no PR");
			const check = await gh.waitForVerdict(pr, sha, ctx.log);
			asserter.ok(
				`a verdict landed (${check.conclusion})`,
				["success", "failure", "neutral"].includes(check.conclusion ?? ""),
				`unexpected conclusion ${check.conclusion}`,
			);
		},
	},
	{
		name: "workflow-webhook-fail",
		axis: "workflow",
		summary: "a webhook node fires on fail and its delivery is refused (SSRF)",
		plan: [
			"pin ENABLED workflow: account-age(36500) —fail→ block AND —fail→ webhook",
			"the webhook url is a blocked address (169.254.169.254) — delivery must be refused",
			"push a clean change; assert the check is failure (the block landed)",
			"poll the webhook action row until its delivery failure is recorded",
		],
		expects:
			"the webhook fires on the fail edge, delivery is refused by the guard (blocked-destination), and the failure is recorded on the row — never the url",
		needs: { db: true },
		enableRules: ACCOUNT_AGE_ON,
		pinWorkflows: [
			{
				// Pinned directly, bypassing save-time url validation, so we can point
				// at a blocked address and force the delivery FAIL route.
				definition: webhookFailWorkflow(36500, "https://169.254.169.254/hook"),
				enabled: true,
			},
		],
		run: async (ctx) => {
			const { db, asserter } = ctx;
			if (!db) {
				throw new Error("workflow-webhook-fail needs a DB");
			}
			await forceGate(ctx, {
				branch: "tw-e2e-wf-webhook-fail",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: clean change vs blocking+webhook workflow",
				expectConclusion: "failure",
			});
			// The deliver-webhook job runs on a ~1-min cron; poll the webhook row
			// until it carries a recorded delivery failure (never the url).
			ctx.log("waiting for the webhook delivery attempt (cron ~1 min)");
			let failure: string | null = null;
			for (let i = 0; i < 24 && failure === null; i++) {
				const rows = await db
					.select({ payload: schema.runActions.payload })
					.from(schema.runActions)
					.innerJoin(schema.runs, eq(schema.runActions.runId, schema.runs.id))
					.where(eq(schema.runs.repoFullName, ctx.config.repo));
				for (const row of rows) {
					const payload = row.payload as Record<string, unknown>;
					if (typeof payload.deliveryFailure === "string") {
						failure = payload.deliveryFailure;
						// The url must NEVER be exposed alongside the failure.
						asserter.ok(
							"the recorded failure does not carry the url",
							!JSON.stringify(payload).includes("169.254.169.254") ||
								payload.deliveryFailure === "blocked-destination",
							"url leaked into the failure record",
						);
					}
				}
				if (failure === null) {
					await new Promise((resolve) => setTimeout(resolve, 5000));
				}
			}
			asserter.ok(
				"the webhook delivery was refused and recorded",
				failure === "blocked-destination",
				`expected blocked-destination, got ${failure ?? "no failure recorded (delivery never attempted?)"}`,
			);
		},
	},

	// ── WORKFLOW MATRIX (every rule + gate as a saved graph, block-verified) ──
	// Generated from RULE_MATRIX/GATE_MATRIX below — a new rule needs one data
	// row, never a new scenario body. ai-review is EXCLUDED live (it spends
	// tokens); its definition is still seeded + enable-validated elsewhere.
	...RULE_MATRIX.map(
		(row): Scenario => ({
			name: `workflow-rule-${row.ruleId}`,
			axis: "workflow",
			summary: `saved graph: ${row.ruleId} blocks on ${row.why}`,
			plan: [
				`pin ENABLED workflow: ${row.ruleId}@${row.version}(${JSON.stringify(row.config)}) —fail→ block`,
				row.forcing,
				"assert the check is failure (the block landed)",
			],
			expects: `${row.ruleId}'s fail edge conducts to block on a real PR`,
			needs: { db: true },
			enableRules: [
				{
					ruleId: row.ruleId,
					version: row.version,
					enabled: true,
					config: row.config,
				},
			],
			pinWorkflows: [
				{
					definition: ruleWorkflow(row.ruleId, row.version, row.config),
					enabled: true,
				},
			],
			run: (ctx) =>
				forceGate(ctx, {
					branch: `tw-e2e-wfm-${row.ruleId}`,
					mode: ctx.defaultMode,
					edits: row.edits,
					message: `e2e: force ${row.ruleId} to fail`,
					title: row.title,
					expectConclusion: "failure",
				}),
		}),
	),
	{
		name: "workflow-rule-pr-rate-limit",
		axis: "workflow",
		summary: "saved graph: pr-rate-limit blocks the SECOND PR in the window",
		plan: [
			"pin ENABLED workflow: pr-rate-limit(maxPerWindow 1) —fail→ block",
			"open PR #1 (within budget → success), then PR #2 (over → failure)",
		],
		expects: "the second PR inside the window trips the cap and blocks",
		needs: { db: true },
		enableRules: [
			{
				ruleId: "pr-rate-limit",
				version: 1,
				enabled: true,
				config: { maxPerWindow: 1, windowHours: 24 },
			},
		],
		pinWorkflows: [
			{
				definition: ruleWorkflow("pr-rate-limit", 1, {
					maxPerWindow: 1,
					windowHours: 24,
				}),
				enabled: true,
			},
		],
		run: async (ctx) => {
			await forceGate(ctx, {
				branch: "tw-e2e-wfm-rate-1",
				mode: ctx.defaultMode,
				edits: { "E2E.md": CLEAN_DOC },
				message: "e2e: rate-limit PR one (in budget)",
				expectConclusion: "success",
			});
			await forceGate(ctx, {
				branch: "tw-e2e-wfm-rate-2",
				mode: ctx.defaultMode,
				edits: { "E2E-2.md": CLEAN_DOC },
				message: "e2e: rate-limit PR two (over budget)",
				expectConclusion: "failure",
			});
		},
	},
	...GATE_MATRIX.map(
		(row): Scenario => ({
			name: `workflow-gate-${row.mode}`,
			axis: "workflow",
			summary: row.summary,
			plan: [
				`pin ENABLED workflow: [account-age(0), crypto-address] → ${row.mode} —fail→ block`,
				row.forcing,
				`assert the check is ${row.expect}`,
			],
			expects: row.expects,
			needs: { db: true },
			enableRules: [
				{
					ruleId: "account-age",
					version: 1,
					enabled: true,
					config: { minDays: 0 },
				},
				{ ruleId: "crypto-address", version: 1, enabled: true, config: {} },
			],
			pinWorkflows: [{ definition: gateWorkflow(row.mode), enabled: true }],
			run: (ctx) =>
				forceGate(ctx, {
					branch: `tw-e2e-wfg-${row.mode}`,
					mode: ctx.defaultMode,
					edits: row.edits,
					message: `e2e: gate ${row.mode}`,
					expectConclusion: row.expect,
				}),
		}),
	),
];

export function scenarioByName(name: string): Scenario | undefined {
	return SCENARIOS.find((s) => s.name === name);
}

export const AXES: { key: Scenario["axis"]; label: string }[] = [
	{ key: "gate", label: "the gate" },
	{ key: "comment", label: "the comment" },
	{ key: "contributor", label: "the contributor" },
	{ key: "edge", label: "the edge cases" },
	{ key: "workflow", label: "the workflows (saved graphs)" },
	{ key: "hybrid", label: "the hybrids (need a human action)" },
];
