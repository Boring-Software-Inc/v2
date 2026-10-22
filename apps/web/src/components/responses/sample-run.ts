import type { JsonValue, RunStepView, RunView } from "#/lib/runs.functions";

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
	actions: [],
};
