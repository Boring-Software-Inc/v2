import { cn } from "#/lib/utils";

export function LiveIndicator({ live }: { live: boolean }) {
	return (
		<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
			<span
				className={cn(
					"size-1.5 rounded-full",
					live ? "bg-emerald-500" : "bg-muted-foreground/40",
				)}
			/>
			{live ? "live" : "connecting"}
		</span>
	);
}
