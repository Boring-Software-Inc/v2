import type { ComponentProps } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";
export type BadgeVariant = "solid" | "outline";

export interface BadgeProps extends ComponentProps<"span"> {
	tone?: BadgeTone;
	size?: "small" | "medium";
	variant?: BadgeVariant;
}

export function Badge({
	className,
	tone = "neutral",
	size = "medium",
	variant = "solid",
	...props
}: BadgeProps) {
	return (
		<span
			className={["ui-badge", className].filter(Boolean).join(" ")}
			data-size={size}
			data-slot="badge"
			data-tone={tone}
			data-variant={variant}
			{...props}
		/>
	);
}
