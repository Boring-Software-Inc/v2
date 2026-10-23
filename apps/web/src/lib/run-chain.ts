import {
	ACTION_CATALOG,
	redactionHides,
	ruleDisplayName,
	VERDICT_LABELS,
} from "@tripwire/contracts";
import { z } from "zod";
import {
	normalizeStepStatus,
	RULES_WORKFLOW_ID,
	RULES_WORKFLOW_NAME,
	splitStepNode,
} from "#/lib/run-workflows";
import type {
	RunActionView,
	RunLinkView,
	RunStepView,
	RunView,
	RunWorkflowView,
	WorkflowOutcome,
} from "#/lib/runs.functions";

export type ChainTone = "ok" | "fail" | "neutral";

export type ChainGlyph =
	| "opened"
	| "pushed"
	| "rerun"
	| "scheduled"
	| "comment"
	| "pass"
	| "fail"
	| "blocked"
	| "skipped"
	| "waiting"
	| "running"
	| "errored"
	| "superseded";

export type RuleMark = "pass" | "fail" | "skipped" | "pending";

export interface ChainRule {
	step: RunStepView;
	mark: RuleMark;
	name: string;
}

export interface ChainBranch {
	id: string;
	name: string;
	isRules: boolean;
	form: "card" | "row";
	passed: ChainRule[];
	flagged: ChainRule[];
	pending: ChainRule[];
	outcome: WorkflowOutcome | null;
}

export type ChainChecksBody =
	| {
			kind: "branches";
			layout: "side" | "stack";
			branches: ChainBranch[];
			passedGroup: ChainBranch[];
			showBranchOutcome: boolean;
	  }
	| { kind: "marks"; marks: RuleMark[] }
	| { kind: "none" };

export interface ChainChecks {
	title: string;
	tone: ChainTone;
	glyph: ChainGlyph;
	offsetMs: number | null;
	body: ChainChecksBody;
}

export interface ChainStep {
	key: string;
	title: string;
	tone: ChainTone;
	glyph: ChainGlyph;
	at: string | null;
	offsetMs: number | null;
}

export interface ChainChip {
	key: string;
	label: string;
	glyph: "pass" | "fail" | "pending" | "review" | "comment" | "send" | "action";
	tone: ChainTone;
	href: string | null;
	internal: boolean;
}

export interface ChainOutcome {
	title: string;
	short: string;
	tone: ChainTone;
	glyph: ChainGlyph;
	at: string | null;
	offsetMs: number | null;
	detail: string | null;
	openReview: { name: string | null } | null;
	chips: ChainChip[];
}

export interface ChainEvent {
	title: string;
	glyph: ChainGlyph;
	at: string;
	detail: string | null;
	replaces: RunLinkView | null;
}

export interface RunChain {
	event: ChainEvent;
	checks: ChainChecks | null;
	steps: ChainStep[];
	outcome: ChainOutcome;
}

function shortSha(sha: string | null): string {
	return sha ? sha.slice(0, 7) : "a commit";
}

function subject(number: number | null): string {
	return number === null ? "the change request" : `#${number}`;
}

export function offsetBetween(from: string, to: string | null): number | null {
	if (!to) {
		return null;
	}
	const ms = Date.parse(to) - Date.parse(from);
	return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

export function formatOffset(ms: number): string {
	if (ms < 1000) {
		return `+${Math.round(ms)}ms`;
	}
	if (ms < 60_000) {
		const seconds = ms / 1000;
		return `+${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
	}
	if (ms < 3_600_000) {
		return `+${Math.round(ms / 60_000)}m`;
	}
	return `+${Math.round(ms / 3_600_000)}h`;
}

function eventChain(run: RunView): ChainEvent {
	const event = run.event;
	const actor = event?.actor ?? "Someone";
	const on = subject(run.subjectNumber);
	let title: string;
	let glyph: ChainGlyph = "opened";
	if (run.rerun) {
		title = run.rerunBy
			? `${run.rerunBy} re-ran the rules on ${on}`
			: `Rules re-run on ${on}`;
		glyph = "rerun";
	} else if (event?.kind === "schedule.matched") {
		title = "Matched by schedule";
		glyph = "scheduled";
	} else if (event?.kind === "change-request.updated") {
		title = `${actor} pushed ${shortSha(event.headSha ?? run.headSha)} to ${on}`;
		glyph = "pushed";
	} else if (event?.kind === "push") {
		title = `${actor} pushed ${shortSha(event.headSha ?? run.headSha)}`;
		glyph = "pushed";
	} else if (event?.kind === "comment.created") {
		title = `${actor} commented on ${on}`;
		glyph = "comment";
	} else if (event?.kind === "change-request.closed") {
		title = `${actor} closed ${on}`;
	} else {
		title = `${actor} opened ${on}`;
	}
	return {
		title,
		glyph,
		at: run.rerun ? run.createdAt : (event?.at ?? run.createdAt),
		detail: event?.title ?? null,
		replaces: run.previousRun,
	};
}

function ruleMark(status: string): RuleMark | null {
	const normal = normalizeStepStatus(status);
	if (normal === "pass" || normal === "fail" || normal === "skipped") {
		return normal;
	}
	if (normal === "pending" || normal === "running") {
		return "pending";
	}
	return null;
}

function ruleName(step: RunStepView): string {
	if (step.ruleName) {
		return step.ruleName;
	}
	return step.ruleRef ? ruleDisplayName(step.ruleRef) : "A check";
}

function chainRules(steps: readonly RunStepView[]): ChainRule[] {
	return steps.flatMap((step) => {
		if (step.nodeKind !== "rule") {
			return [];
		}
		const mark = ruleMark(step.status);
		return mark ? [{ step, mark, name: ruleName(step) }] : [];
	});
}

function branchOf(
	workflow: { id: string; name: string; outcome: WorkflowOutcome | null },
	rules: ChainRule[],
): ChainBranch {
	return {
		id: workflow.id,
		name: workflow.name,
		isRules: workflow.id === RULES_WORKFLOW_ID,
		form: "card",
		passed: rules.filter((rule) => rule.mark === "pass"),
		flagged: rules.filter(
			(rule) => rule.mark === "fail" || rule.mark === "skipped",
		),
		pending: rules.filter((rule) => rule.mark === "pending"),
		outcome: workflow.outcome,
	};
}

export function branchPassed(branch: ChainBranch): boolean {
	if (branch.pending.length > 0) {
		return false;
	}
	return branch.outcome === null
		? branch.flagged.length === 0
		: branch.outcome === "pass";
}

export function buildBranches(
	workflows: readonly RunWorkflowView[],
	steps: readonly RunStepView[],
	collapseAll: boolean,
): Extract<ChainChecksBody, { kind: "branches" }> {
	const ids = workflows.map((workflow) => workflow.id);
	const rules = chainRules(steps);
	const known: RunWorkflowView[] =
		workflows.length > 0
			? [...workflows]
			: [{ id: RULES_WORKFLOW_ID, name: RULES_WORKFLOW_NAME, outcome: null }];
	const all = known
		.map((workflow) =>
			branchOf(
				workflow,
				rules.filter((rule) => {
					const owner = splitStepNode(rule.step.nodeId, ids).workflowId;
					return (owner ?? known[0]?.id) === workflow.id;
				}),
			),
		)
		.filter(
			(branch) =>
				branch.outcome === "unrunnable" ||
				branch.passed.length + branch.flagged.length + branch.pending.length >
					0,
		);
	const ordered = [
		...all.filter((branch) => branch.isRules),
		...all.filter((branch) => !branch.isRules && !branchPassed(branch)),
		...all.filter((branch) => !branch.isRules && branchPassed(branch)),
	];
	const showBranchOutcome = ordered.length > 1;
	if (collapseAll) {
		return {
			kind: "branches",
			layout: "stack",
			branches: ordered.map((branch) => ({ ...branch, form: "row" })),
			passedGroup: [],
			showBranchOutcome,
		};
	}
	if (ordered.length <= 1) {
		return {
			kind: "branches",
			layout: "stack",
			branches: ordered,
			passedGroup: [],
			showBranchOutcome,
		};
	}
	if (ordered.every(branchPassed)) {
		return {
			kind: "branches",
			layout: "stack",
			branches: [],
			passedGroup: ordered,
			showBranchOutcome,
		};
	}
	const shown: ChainBranch[] = [];
	const passedOthers = ordered.filter(
		(branch) => !branch.isRules && branchPassed(branch),
	);
	for (const branch of ordered) {
		if (branch.isRules) {
			shown.push({ ...branch, form: branchPassed(branch) ? "row" : "card" });
		} else if (!branchPassed(branch)) {
			shown.push(branch);
		}
	}
	let passedGroup: ChainBranch[] = [];
	if (passedOthers.length === 1 && passedOthers[0]) {
		shown.push({ ...passedOthers[0], form: "row" });
	} else {
		passedGroup = passedOthers;
	}
	const side =
		passedGroup.length === 0 &&
		shown.length === 2 &&
		shown.every((branch) => branch.form === "card");
	return {
		kind: "branches",
		layout: side ? "side" : "stack",
		branches: shown,
		passedGroup,
		showBranchOutcome,
	};
}

function unrunnableCount(run: RunView): number {
	return run.workflows.filter((workflow) => workflow.outcome === "unrunnable")
		.length;
}

function withUnrunnable(title: string, run: RunView): string {
	const count = unrunnableCount(run);
	if (count === 0) {
		return title;
	}
	return `${title}. ${count} ${count === 1 ? "workflow" : "workflows"} could not run`;
}

function checksNode(
	run: RunView,
	steps: readonly RunStepView[],
	collapseAll: boolean,
): ChainChecks | null {
	if (run.stepsHidden) {
		return null;
	}
	const rules = chainRules(steps);
	if (rules.length === 0) {
		return null;
	}
	const level = run.redactionLevel;
	const failed = rules.filter((rule) => rule.mark === "fail").length;
	const skipped = rules.filter((rule) => rule.mark === "skipped").length;
	const pending = rules.filter((rule) => rule.mark === "pending").length;
	const total = rules.length;
	const first = rules
		.filter((rule) => rule.mark !== "pending")
		.map((rule) => rule.step.startedAt)
		.sort()[0];
	const offsetMs = first ? offsetBetween(run.createdAt, first) : null;
	if (redactionHides(level, "passed-count")) {
		return {
			title:
				failed > 0
					? `${failed} ${failed === 1 ? "rule" : "rules"} did not pass`
					: "Rules passed",
			tone: failed > 0 ? "fail" : "ok",
			glyph: failed > 0 ? "fail" : "pass",
			offsetMs,
			body: { kind: "none" },
		};
	}
	const body: ChainChecksBody = redactionHides(level, "rule-names")
		? { kind: "marks", marks: rules.map((rule) => rule.mark) }
		: buildBranches(run.workflows, steps, collapseAll);
	if (pending > 0) {
		return {
			title: `${total - pending} of ${total} rules checked`,
			tone: "neutral",
			glyph: "running",
			offsetMs,
			body,
		};
	}
	if (failed > 0) {
		return {
			title: withUnrunnable(`${failed} of ${total} rules did not pass`, run),
			tone: run.verdict === "pass" ? "neutral" : "fail",
			glyph: "fail",
			offsetMs,
			body,
		};
	}
	if (skipped > 0) {
		return {
			title: withUnrunnable(`${skipped} of ${total} rules skipped`, run),
			tone: "neutral",
			glyph: "skipped",
			offsetMs,
			body,
		};
	}
	const unrunnable = unrunnableCount(run);
	if (unrunnable > 0) {
		return {
			title: withUnrunnable(`${total} of ${total} rules passed`, run),
			tone: "neutral",
			glyph: "skipped",
			offsetMs,
			body,
		};
	}
	return {
		title: `${total} of ${total} rules passed`,
		tone: run.verdict === "block" ? "neutral" : "ok",
		glyph: "pass",
		offsetMs,
		body,
	};
}

function joinNames(names: readonly string[]): string {
	if (names.length <= 1) {
		return names[0] ?? "";
	}
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function checkChip(run: RunView, action: RunActionView): ChainChip {
	const base = {
		key: `${action.kind}-${action.recordedAt}`,
		href: action.url,
		internal: false,
	};
	if (run.verdict === "block") {
		return {
			...base,
			label: "Check blocked",
			glyph: "fail",
			tone: "fail",
		};
	}
	if (run.verdict === "pass") {
		return {
			...base,
			label: "Check passed",
			glyph: "pass",
			tone: "ok",
		};
	}
	return { ...base, label: "Check pending", glyph: "pending", tone: "neutral" };
}

function deliveryLabel(target: string, action: RunActionView): string {
	if (action.delivery?.state === "failed") {
		return `${target} not sent`;
	}
	if (action.delivery?.state === "queued") {
		return `${target} queued`;
	}
	return `Sent to ${target}`;
}

const CHIP_ORDER = ["set-check", "block", "comment"];

const ONE_CHIP_KINDS = new Set([
	"set-check",
	"block",
	"comment",
	"dismiss-review",
]);

function latestPerKind(actions: readonly RunActionView[]): RunActionView[] {
	return actions.filter(
		(action, index) =>
			!ONE_CHIP_KINDS.has(action.kind) ||
			action.status !== "executed" ||
			!actions
				.slice(index + 1)
				.some(
					(later) => later.kind === action.kind && later.status === "executed",
				),
	);
}

export function outcomeChips(run: RunView): ChainChip[] {
	const chips: ChainChip[] = [];
	const ordered = latestPerKind(run.actions).sort(
		(a, b) =>
			(CHIP_ORDER.indexOf(a.kind) + 1 || 99) -
			(CHIP_ORDER.indexOf(b.kind) + 1 || 99),
	);
	for (const action of ordered) {
		const key = `${action.kind}-${action.recordedAt}`;
		if (action.kind === "discord" || action.kind === "webhook") {
			chips.push({
				key,
				label: deliveryLabel(
					action.kind === "discord" ? "Discord" : "a webhook",
					action,
				),
				glyph: "send",
				tone: "neutral",
				href: null,
				internal: false,
			});
			continue;
		}
		if (action.status !== "executed") {
			continue;
		}
		if (action.kind === "set-check") {
			chips.push(checkChip(run, action));
		} else if (action.kind === "block") {
			chips.push({
				key,
				label: "Requested changes",
				glyph: "review",
				tone: "neutral",
				href: action.url,
				internal: false,
			});
		} else if (action.kind === "comment") {
			chips.push({
				key,
				label: action.label ?? "Verdict comment",
				glyph: "comment",
				tone: "neutral",
				href: action.url,
				internal: false,
			});
		} else if (action.kind === "dismiss-review") {
			chips.push({
				key,
				label: "Dismissed its review",
				glyph: "review",
				tone: "neutral",
				href: action.url,
				internal: false,
			});
		} else if (action.kind === "delete-comment") {
		} else if (action.kind !== "send-to-moderation") {
			chips.push({
				key,
				label:
					action.label ??
					ACTION_CATALOG.find((entry) => entry.action === action.kind)?.name ??
					action.kind,
				glyph: "action",
				tone: "neutral",
				href: action.url,
				internal: false,
			});
		}
	}
	return chips.filter(
		(chip, index) =>
			chips.findIndex(
				(other) => other.label === chip.label && other.href === chip.href,
			) === index,
	);
}

function workflowNameById(run: RunView, id: string | null): string | null {
	if (!id) {
		return null;
	}
	return run.workflows.find((workflow) => workflow.id === id)?.name ?? null;
}

function latest(times: readonly string[]): string | null {
	return times.reduce<string | null>(
		(last, at) =>
			last === null || Date.parse(at) > Date.parse(last) ? at : last,
		null,
	);
}

function outcomeReachedAt(run: RunView): string | null {
	if (run.completedAt) {
		return run.completedAt;
	}
	const opened = latest(run.reviews.map((review) => review.openedAt));
	if (opened) {
		return opened;
	}
	return latest(
		run.steps.map((step) =>
			new Date(Date.parse(step.startedAt) + step.durationMs).toISOString(),
		),
	);
}

function verdictOutcome(run: RunView): ChainOutcome {
	const offsetMs = offsetBetween(run.createdAt, outcomeReachedAt(run));
	const base = {
		at: null,
		offsetMs,
		detail: null,
		openReview: null,
		chips: outcomeChips(run),
	};
	if (run.status === "queued" || run.status === "running") {
		return {
			...base,
			offsetMs: null,
			title: "Checking",
			short: "Checking",
			tone: "neutral",
			glyph: "running",
		};
	}
	if (run.status === "failed") {
		return {
			...base,
			title: "Did not finish",
			short: "Did not finish",
			tone: "neutral",
			glyph: "errored",
		};
	}
	if (run.verdict === "block") {
		const denied = run.reviews.some((review) => review.state === "denied");
		const blockers = run.workflows
			.filter((workflow) => workflow.outcome === "block")
			.map((workflow) => workflow.name);
		const open = run.reviews.find(
			(review) => review.state === "open" && !review.degraded,
		);
		return {
			...base,
			title:
				!denied && blockers.length > 0
					? `Blocked by ${joinNames(blockers)}`
					: VERDICT_LABELS.block,
			short: VERDICT_LABELS.block,
			tone: "fail",
			glyph: "blocked",
			openReview:
				open && !run.stepsHidden
					? { name: workflowNameById(run, open.workflowId) }
					: null,
		};
	}
	if (run.verdict === "pass") {
		return {
			...base,
			title: VERDICT_LABELS.pass,
			short: VERDICT_LABELS.pass,
			tone: "ok",
			glyph: "pass",
		};
	}
	if (run.verdict === "needs_review") {
		const degraded = run.reviews.some((review) => review.degraded);
		if (
			run.reviews.length > 0 &&
			run.reviews.every((review) => review.state === "closed")
		) {
			return {
				...base,
				title: "Closed before review",
				short: "Closed before review",
				tone: "neutral",
				glyph: "skipped",
			};
		}
		return {
			...base,
			title: VERDICT_LABELS.needs_review,
			short: VERDICT_LABELS.needs_review,
			tone: "neutral",
			glyph: "waiting",
			detail: degraded ? "Tripwire could not check every rule." : null,
		};
	}
	return {
		...base,
		title: "No verdict",
		short: "No verdict",
		tone: "neutral",
		glyph: "errored",
	};
}

function decisionSteps(run: RunView): ChainStep[] {
	return run.reviews.flatMap((review, index): ChainStep[] => {
		if (review.state === "open" || review.state === "closed") {
			return [];
		}
		const by = review.decidedBy ?? "a maintainer";
		return [
			{
				key: `hold-${index}`,
				title: "Human review",
				tone: "neutral",
				glyph: "waiting",
				at: null,
				offsetMs: offsetBetween(run.createdAt, review.openedAt),
			},
			{
				key: `decision-${index}`,
				title:
					review.state === "approved"
						? `Approved by ${by}`
						: `Blocked by ${by}`,
				tone: review.state === "approved" ? "ok" : "fail",
				glyph: review.state === "approved" ? "pass" : "fail",
				at: review.decidedAt,
				offsetMs: offsetBetween(run.createdAt, review.decidedAt),
			},
		];
	});
}

function nextRunWord(next: RunLinkView): string {
	if (next.status === "queued" || next.status === "running") {
		return "Newer run is checking";
	}
	if (next.verdict === "pass") {
		return "Newer run passed";
	}
	if (next.verdict === "block") {
		return "Newer run blocked";
	}
	if (next.verdict === "needs_review") {
		return "Newer run is waiting for human review";
	}
	return "Newer run";
}

function nextRunDetail(next: RunLinkView, number: number | null): string {
	const actor = next.actor ?? "Someone";
	if (next.rerun) {
		return "The rules were re-run.";
	}
	if (
		next.eventKind === "change-request.updated" ||
		next.eventKind === "push"
	) {
		return `${actor} pushed ${shortSha(next.headSha)}.`;
	}
	if (next.eventKind === "comment.created") {
		return `${actor} commented on ${subject(number)}.`;
	}
	return `${actor} opened ${subject(number)} again.`;
}

function supersededOutcome(run: RunView, next: RunLinkView): ChainOutcome {
	const tone: ChainTone =
		next.verdict === "pass"
			? "ok"
			: next.verdict === "block"
				? "fail"
				: "neutral";
	return {
		title: "Superseded",
		short: "Superseded",
		tone: "neutral",
		glyph: "superseded",
		at: next.createdAt,
		offsetMs: offsetBetween(run.createdAt, next.createdAt),
		detail: nextRunDetail(next, run.subjectNumber),
		openReview: null,
		chips: [
			{
				key: `next-${next.id}`,
				label: nextRunWord(next),
				glyph: tone === "ok" ? "pass" : tone === "fail" ? "fail" : "pending",
				tone,
				href: next.id,
				internal: true,
			},
		],
	};
}

export function buildRunChain(
	run: RunView,
	steps: readonly RunStepView[] = run.steps,
): RunChain {
	const decided = run.reviews.some((review) => review.state !== "open");
	const superseded = run.nextRun;
	const collapseAll = decided || superseded !== null;
	const verdict = verdictOutcome(run);
	const chainSteps = decisionSteps(run);
	if (superseded) {
		chainSteps.push({
			key: "verdict",
			title: verdict.title,
			tone: verdict.tone,
			glyph: verdict.glyph === "blocked" ? "fail" : verdict.glyph,
			at: null,
			offsetMs: verdict.offsetMs,
		});
	}
	return {
		event: eventChain(run),
		checks: checksNode(run, steps, collapseAll),
		steps: chainSteps,
		outcome: superseded ? supersededOutcome(run, superseded) : verdict,
	};
}

export interface BranchSummary {
	tone: ChainTone;
	glyph: ChainGlyph;
	text: string;
}

export function branchSummary(branch: ChainBranch): BranchSummary {
	if (branch.outcome === "unrunnable") {
		return { tone: "neutral", glyph: "skipped", text: "Could not run" };
	}
	const failed = branch.flagged.filter((rule) => rule.mark === "fail");
	const skipped = branch.flagged.filter((rule) => rule.mark === "skipped");
	if (failed.length > 0) {
		return {
			tone: "fail",
			glyph: "fail",
			text: `${joinNames(failed.map((rule) => rule.name))} did not pass`,
		};
	}
	if (branch.pending.length > 0) {
		const total =
			branch.passed.length + branch.flagged.length + branch.pending.length;
		return {
			tone: "neutral",
			glyph: "running",
			text: `${total - branch.pending.length} of ${total} done`,
		};
	}
	if (skipped.length > 0) {
		return {
			tone: "neutral",
			glyph: "skipped",
			text: `${joinNames(skipped.map((rule) => rule.name))} skipped`,
		};
	}
	return { tone: "ok", glyph: "pass", text: `${branch.passed.length} passed` };
}

export interface BranchOutcomeLabel {
	tone: ChainTone;
	glyph: ChainGlyph;
	label: string;
}

export function branchOutcomeLabel(
	branch: ChainBranch,
): BranchOutcomeLabel | null {
	if (branch.outcome === "block") {
		return { tone: "fail", glyph: "fail", label: "Blocked" };
	}
	if (branch.outcome === "review") {
		return { tone: "neutral", glyph: "waiting", label: "Human review" };
	}
	if (branch.outcome === "pass") {
		return { tone: "ok", glyph: "pass", label: "Passed" };
	}
	if (branch.outcome === "unrunnable") {
		return { tone: "neutral", glyph: "skipped", label: "Could not run" };
	}
	return null;
}

const skipReasonSchema = z.object({ reason: z.string() });

function asSentence(text: string): string {
	const trimmed = text.trim();
	const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
	return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function ruleReason(rule: ChainRule, level: number): string | null {
	if (rule.mark === "pass" || redactionHides(level, "reasons")) {
		return null;
	}
	const step = rule.step;
	if (step.summary) {
		return asSentence(step.summary);
	}
	const skip = skipReasonSchema.safeParse(step.evidence);
	if (rule.mark === "skipped" && skip.success) {
		return skip.data.reason;
	}
	return null;
}
