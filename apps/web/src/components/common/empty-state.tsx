import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * The shared empty state (§9). An empty surface says WHAT WILL FILL IT, never
 * just that it's empty — a freshly-installed repo is the common case, not an
 * error. Near-monochrome, dashed card, one earned icon; matches the demo tokens.
 */
export function EmptyState({
	icon,
	title,
	description,
	action,
	className,
}: {
	icon?: ComponentProps<typeof HugeiconsIcon>["icon"];
	title: string;
	description: string;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center",
				className,
			)}
		>
			{icon ? (
				<div className="flex size-10 items-center justify-center rounded-full bg-surface-1 text-muted-foreground">
					<HugeiconsIcon icon={icon} size={18} strokeWidth={1.8} />
				</div>
			) : null}
			<div className="space-y-1">
				<p className="font-medium text-foreground text-sm">{title}</p>
				<p className="mx-auto max-w-sm text-muted-foreground text-xs leading-relaxed">
					{description}
				</p>
			</div>
			{action}
		</div>
	);
}
