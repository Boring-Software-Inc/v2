import type { ReactNode } from "react";
import { cn } from "#/lib/glaze/utils";

export function MetaRow({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"flex min-w-0 items-baseline gap-x-3 *:shrink-0 *:last:min-w-0 *:last:shrink *:last:truncate",
				className,
			)}
		>
			{children}
		</span>
	);
}
