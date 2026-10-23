import type { ReactNode } from "react";
import { cn } from "#/lib/glaze/utils";

export function MetaRow({
	children,
	className,
	wrap = false,
}: {
	children: ReactNode;
	className?: string;
	wrap?: boolean;
}) {
	return (
		<span
			className={cn(
				wrap
					? "flex min-w-0 flex-wrap items-baseline gap-x-3 *:min-w-0 *:max-w-full *:truncate"
					: "flex min-w-0 items-baseline gap-x-3 *:shrink-0 *:last:min-w-0 *:last:shrink *:last:truncate",
				className,
			)}
		>
			{children}
		</span>
	);
}
