import { bearsVerdict, type EventKind } from "@tripwire/contracts";
import { Status, type StatusValue } from "#/components/glaze/ui/status";

type VerdictChipMap = Record<string, { status: StatusValue; label: string }>;
const VERDICT: VerdictChipMap = {
	block: { status: "fail", label: "Blocked" },
	pass: { status: "ok", label: "Passed" },
	needs_review: { status: "waiting", label: "Human review" },
};

export function verdictStatus(
	verdict: string | null | undefined,
): { status: StatusValue; label: string } | undefined {
	return verdict ? VERDICT[verdict] : undefined;
}

interface OutcomeLabel {
	status: StatusValue;
	label: string;
}

const RAN = { status: "idle", label: "Ran" } satisfies OutcomeLabel;

export function runOutcome(
	kind: EventKind,
	verdict: string | null | undefined,
): OutcomeLabel | undefined {
	if (!verdict || bearsVerdict(kind) || verdict === "needs_review") {
		return verdictStatus(verdict);
	}
	return RAN;
}

export function VerdictChip({
	verdict,
	size = "sm",
	className,
}: {
	verdict: string | null;
	size?: "sm" | "default";
	className?: string;
}) {
	const v = verdictStatus(verdict);
	if (!v) {
		return null;
	}
	return (
		<Status className={className} size={size} status={v.status}>
			{v.label}
		</Status>
	);
}
