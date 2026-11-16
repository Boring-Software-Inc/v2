import {
	Tooltip as BehaviorTooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ui-sdk/react/tooltip";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { type InteractionDetails, interactionDetails } from "./interaction";
import {
	type PopupAlign,
	type PopupOffset,
	type PopupPlacement,
	popupOffsetValue,
} from "./popup";

interface TooltipTriggerProps {
	"aria-hidden"?: boolean | "true" | "false";
	"aria-label"?: string;
	"aria-labelledby"?: string;
	children?: ReactNode;
	title?: string;
}

function hasTriggerText(content: ReactNode): boolean {
	if (Array.isArray(content)) return content.some(hasTriggerText);
	if (isValidElement<TooltipTriggerProps>(content)) {
		return (
			content.props["aria-hidden"] !== true &&
			content.props["aria-hidden"] !== "true" &&
			hasTriggerText(content.props.children)
		);
	}
	const boxed = Object(content);
	return (
		(boxed instanceof String && Boolean(boxed.trim())) ||
		boxed instanceof Number
	);
}

interface TooltipOptions {
	align?: PopupAlign;
	children: string;
	offset?: PopupOffset;
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	placement?: PopupPlacement;
	trigger: ReactElement<TooltipTriggerProps>;
	variant?: "default" | "sidebar";
}

export type TooltipProps = TooltipOptions &
	(
		| { open: boolean; defaultOpen?: never }
		| { open?: never; defaultOpen?: boolean }
	);

export function Tooltip({
	align = "center",
	children,
	defaultOpen,
	offset,
	onOpenChange,
	open,
	placement,
	trigger,
	variant = "default",
}: TooltipProps) {
	const label = children.trim();
	if (!label) return trigger;
	const sidebar = variant === "sidebar";
	const native = trigger.type === "button" || trigger.type === "a";
	const fallbackLabel =
		native &&
		!trigger.props["aria-label"] &&
		!trigger.props["aria-labelledby"] &&
		!trigger.props.title &&
		!hasTriggerText(trigger.props.children)
			? label
			: undefined;
	return (
		<BehaviorTooltip
			defaultOpen={defaultOpen}
			delay={sidebar ? 0 : 500}
			onOpenChange={(nextOpen, details) =>
				onOpenChange?.(nextOpen, interactionDetails(details))
			}
			open={open}
		>
			<TooltipTrigger
				aria-label={fallbackLabel}
				data-slot="tooltip-trigger"
				render={trigger}
			/>
			<TooltipContent
				align={align}
				data-slot="tooltip-content"
				data-variant={variant}
				side={placement ?? (sidebar ? "right" : "top")}
				sideOffset={offset ? popupOffsetValue(offset) : sidebar ? 12 : 6}
			>
				{label}
			</TooltipContent>
		</BehaviorTooltip>
	);
}
