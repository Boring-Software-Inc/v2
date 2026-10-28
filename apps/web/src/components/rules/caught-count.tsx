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
	if (!count) {
		return null;
	}
	return (
		<span
			className={cn(
				"shrink-0 type-body-sm text-text-1 tabular-nums",
				className,
			)}
		>
			{caughtLabel(count)}
		</span>
	);
}
