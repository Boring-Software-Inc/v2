import {
	type ActivityGroup,
	bearsVerdict,
	type EventKind,
	RUN_RESULT_LABELS,
	type RunResult,
	runResult,
} from "@tripwire/contracts";
import { Status, type StatusValue } from "#/components/glaze/ui/status";

interface OutcomeLabel {
	status: StatusValue;
	label: string;
}

const OUTCOMES = {
	pass: { status: "ok", label: RUN_RESULT_LABELS.pass },
	block: { status: "fail", label: RUN_RESULT_LABELS.block },
	needs_review: { status: "waiting", label: "Human review" },
	"closed-before-review": {
		status: "idle",
		label: RUN_RESULT_LABELS["closed-before-review"],
	},
	ran: { status: "idle", label: RUN_RESULT_LABELS.ran },
	"did-not-finish": {
		status: "idle",
		label: RUN_RESULT_LABELS["did-not-finish"],
	},
} satisfies Record<Exclude<RunResult, "checking">, OutcomeLabel>;

interface RunState {
	status: string;
	verdict: string | null;
}

function outcomeOf(result: RunResult | null): OutcomeLabel | undefined {
	return result && result !== "checking" ? OUTCOMES[result] : undefined;
}

export function runOutcome(
	kind: EventKind,
	run: RunState | null | undefined,
): OutcomeLabel | undefined {
	return run
		? outcomeOf(runResult({ ...run, bearsVerdict: bearsVerdict(kind) }))
		: undefined;
}

export function groupResult(group: ActivityGroup): RunResult | null {
	const current = group.timeline.find(
		(entry) => entry.run?.runId === group.currentRunId,
	)?.run;
	return runResult({
		status: current?.status ?? "completed",
		verdict: group.currentVerdict,
		bearsVerdict: true,
	});
}

export function groupOutcome(group: ActivityGroup): OutcomeLabel | undefined {
	return outcomeOf(groupResult(group));
}

export function VerdictChip({
	outcome,
	size = "sm",
	className,
}: {
	outcome: OutcomeLabel | undefined;
	size?: "sm" | "default";
	className?: string;
}) {
	if (!outcome) {
		return null;
	}
	return (
		<Status className={className} size={size} status={outcome.status}>
			{outcome.label}
		</Status>
	);
}
