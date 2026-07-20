import type { AccessStatus } from "@tripwire/contracts";
import { cn } from "#/lib/utils";

/**
 * accessStatus as the severity idiom — a dot marker plus a sans word, never a
 * filled pill. Pending carries the one earned hue on the users table.
 */
const DOT: Record<AccessStatus, string> = {
	pending: "bg-amber-500",
	approved: "bg-muted-foreground/60",
	rejected: "bg-red-500",
};

export function AccessStatusDot({ status }: { status: AccessStatus }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
			<span className={cn("size-1.5 rounded-full", DOT[status])} />
			{status}
		</span>
	);
}
