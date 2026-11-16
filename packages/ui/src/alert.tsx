import type { ComponentProps } from "react";
import { Failed, Icon, Information, Success, Warning } from "./icon";

export type AlertStatus = "info" | "success" | "warning" | "danger";

const NOTICE_ICONS = {
	danger: Failed,
	info: Information,
	success: Success,
	warning: Warning,
} as const;

export interface AlertProps extends ComponentProps<"section"> {
	status?: AlertStatus;
	variant?: "notice";
}

export function Alert({
	children,
	status = "info",
	variant,
	...props
}: AlertProps) {
	return (
		<section
			data-slot="alert"
			data-status={status}
			data-variant={variant}
			{...props}
		>
			{variant === "notice" ? (
				<span data-slot="alert-icon">
					<Icon icon={NOTICE_ICONS[status]} size={14} />
				</span>
			) : null}
			{children}
		</section>
	);
}

export function AlertTitle(props: ComponentProps<"div">) {
	return <div data-slot="alert-title" {...props} />;
}

export function AlertDescription(props: ComponentProps<"div">) {
	return <div data-slot="alert-description" {...props} />;
}

export function AlertAction(props: ComponentProps<"div">) {
	return <div data-slot="alert-action" {...props} />;
}
