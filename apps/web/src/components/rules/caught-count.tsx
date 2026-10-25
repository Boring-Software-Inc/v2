import { cn } from "#/lib/glaze/utils";

export function caughtLabel(count: number): string {
	return `Would have caught ${count}`;
}

export function CaughtCount({
	count,
	className,
}: {
	count: number | null;
	className?: string;
}) {
	if (count === null) {
		return null;
	}
	return (
		<span
			className={cn(
				"shrink-0 type-body-sm tabular-nums",
				count > 0 ? "text-text-1" : "text-text-2",
				className,
			)}
		>
			{caughtLabel(count)}
		</span>
	);
}
