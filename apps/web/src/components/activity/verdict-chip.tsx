import { Status, type StatusValue } from "#/components/glaze/ui/status";

const VERDICT: Record<string, { status: StatusValue; label: string }> = {
	block: { status: "fail", label: "Blocked" },
	pass: { status: "ok", label: "Passed" },
	needs_review: { status: "waiting", label: "Sent to review" },
};

export function verdictStatus(
	verdict: string | null | undefined,
): { status: StatusValue; label: string } | undefined {
	return verdict ? VERDICT[verdict] : undefined;
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
