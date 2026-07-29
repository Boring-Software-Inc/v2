import type * as React from "react";

import { cn } from "#/lib/utils";

/**
 * Placeholder block for pending UI. Hidden from assistive tech: a skeleton is
 * a shape standing in for content, and announcing a screenful of them says
 * nothing. The loading state itself is announced once by [[RouteProgress]].
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			aria-hidden="true"
			data-slot="skeleton"
			className={cn("bg-surface-skeleton animate-pulse rounded-md", className)}
			{...props}
		/>
	);
}

export { Skeleton };
