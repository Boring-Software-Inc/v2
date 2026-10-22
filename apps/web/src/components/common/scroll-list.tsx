import type { ReactNode } from "react";
import { cn } from "#/lib/glaze/utils";

export function ScrollList({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={label}
			className={cn("max-h-112 min-h-0 overflow-y-auto", className)}
		>
			{children}
		</section>
	);
}
