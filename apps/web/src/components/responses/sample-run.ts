import type { SurfacePlan } from "@tripwire/contracts";
import type {
	CheckPreview,
	OutcomeMeta,
	OutcomeScope,
} from "#/components/responses/responses-model";
import type {
	JsonValue,
	RunActionView,
	RunStepView,
	RunView,
	WorkflowOutcome,
} from "#/lib/runs.functions";

function ruleStep(
	id: string,
	ruleRef: string,
	status: "pass" | "fail",
	evidence: JsonValue,
	summary: string,
): RunStepView {
	const [ruleId, version] = ruleRef.split("@");
	return {
		id,
		nodeId: `default@1:${ruleId}`,
		nodeKind: "rule",
		ruleRef,
		status,
		evidence: {
			ruleId: ruleId ?? ruleRef,
			version: Number(version),
			status: "evaluated",
			passed: status === "pass",
			evaluatedAt: "2026-10-21T10:14:59.000Z",
			evidence,
		},
		output: null,
		durationMs: 40,
		startedAt: "2026-10-21T10:14:58.000Z",
		publicEvidence: evidence,
		summary,
	};
}

export const SAMPLE_RUN: RunView = {
	id: "sample",
	repoFullName: "acme/widgets",
	subjectNumber: 88,
	subjectKind: "change-request",
	headSha: "8de51ef9f624c5d35fe48b55f6cc5486eecf5672",
	status: "completed",
	verdict: "block",
	createdAt: "2026-10-21T10:14:58.000Z",
	completedAt: "2026-10-21T10:14:59.000Z",
	snapshot: null,
	access: "full",
	rerun: false,
	rerunBy: null,
	orgSlug: null,
	repoName: null,
	forge: "github",
	subjectUrl: null,
	canRerun: false,
	stepsHidden: false,
	steps: [
		ruleStep(
			"sample-crypto",
			"crypto-address@1",
			"fail",
			{
				matches: [
					{
						kind: "ethereum",
						value: "0x52908400098527886E0F7030069857D2E4169EE7",
						location: "DONATE.md",
					},
				],
			},
			"It adds a crypto wallet address to DONATE.md.",
		),
		ruleStep(
			"sample-ai",
			"ai-review@2",
			"fail",
			{
				output: {
					verdict: "block",
					confidence: 0.9,
					summary: "It adds a donation address with no related code change.",
					findings: [
						{
							severity: "warn",
							file: "DONATE.md",
							line: 3,
							note: "Adds `0x5290…9EE7` with no context.",
						},
					],
				},
			},
			"It adds a donation address with no related code change.",
		),
		ruleStep(
			"sample-age",
			"account-age@1",
			"pass",
			{ accountAgeDays: 412 },
			"Your account is 412 days old.",
		),
		ruleStep(
			"sample-files",
			"max-files-changed@1",
			"pass",
			{ filesChanged: 1 },
			"It changes 1 file.",
		),
	],
	actions: [
		{
			kind: "set-check",
			status: "executed",
			recordedAt: "2026-10-21T10:14:59.000Z",
			url: null,
		},
		{
			kind: "block",
			status: "executed",
			recordedAt: "2026-10-21T10:14:59.000Z",
			url: null,
		},
		{
			kind: "comment",
			status: "executed",
			recordedAt: "2026-10-21T10:14:59.000Z",
			url: null,
		},
	],
	redactionLevel: 0,
	event: {
		kind: "change-request.opened",
		actor: "new-contributor",
		title: "Add a donate page",
		headSha: "8de51ef9f624c5d35fe48b55f6cc5486eecf5672",
		at: "2026-10-21T10:14:58.000Z",
	},
	workflows: [{ id: "default@1", name: "Rules", outcome: "block" }],
	reviews: [],
	previousRun: null,
	nextRun: null,
	backfill: false,
	aiReviewNotRun: false,
};

const WORKFLOW_OUTCOMES = {
	block: "block",
	changes_required: "changes",
	needs_review: "review",
	note: "pass",
	close: "close",
} satisfies Record<OutcomeScope, WorkflowOutcome>;

export function sampleRunFor(
	outcome: OutcomeMeta,
	plan: SurfacePlan,
	check: CheckPreview,
): RunView {
	const at = SAMPLE_RUN.completedAt ?? SAMPLE_RUN.createdAt;
	const action = (kind: string): RunActionView => ({
		kind,
		status: "executed",
		recordedAt: at,
		url: null,
	});
	return {
		...SAMPLE_RUN,
		verdict: outcome.verdict,
		workflows: SAMPLE_RUN.workflows.map((workflow) => ({
			...workflow,
			outcome: WORKFLOW_OUTCOMES[outcome.value],
		})),
		actions: [
			...(check.posted ? [action("set-check")] : []),
			...(plan.review ? [action("block")] : []),
			...(plan.comment === "upsert" ? [action("comment")] : []),
		],
	};
}
