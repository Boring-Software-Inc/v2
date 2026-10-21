import type { AccessStatus } from "@tripwire/contracts";
import { Status, type StatusValue } from "#/components/glaze/ui/status";

const STATUS = {
	pending: { status: "waiting", label: "Pending" },
	approved: { status: "idle", label: "Approved" },
	rejected: { status: "fail", label: "Declined" },
} satisfies Record<AccessStatus, { status: StatusValue; label: string }>;

export function AccessStatusMark({ status }: { status: AccessStatus }) {
	const { status: value, label } = STATUS[status];
	return (
		<Status size="sm" status={value}>
			{label}
		</Status>
	);
}
