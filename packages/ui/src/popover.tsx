import { XIcon } from "@phosphor-icons/react";
import {
	Popover as BehaviorPopover,
	PopoverClose,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from "@ui-sdk/react/popover";
import { type ReactElement, type ReactNode, useState } from "react";
import { IconButton } from "./button";
import { type InteractionDetails, interactionDetails } from "./interaction";
import type { PopupAlign, PopupPlacement } from "./popup";

interface PopoverBaseProps {
	align?: PopupAlign;
	anchorGap?: "spacious" | "standard";
	children: ReactNode;
	description?: string;
	finalFocus?: "none" | "trigger";
	focusMode?: "nonmodal" | "trap";
	initialFocus?: "auto" | "first-field" | "none";
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	placement?: PopupPlacement;
	title?: string;
	trigger: ReactElement<object>;
	triggerLabel: string;
	variant?: "default" | "menu";
}

type PopoverStateProps =
	| { defaultOpen?: boolean; open?: never }
	| { defaultOpen?: never; open: boolean };

type PopoverInteractionProps =
	| { hoverTiming?: never; interaction?: "click" }
	| { hoverTiming?: "brief" | "standard"; interaction: "hover" };

const HOVER_TIMING = {
	brief: { closeDelay: 150, delay: 150 },
	standard: { closeDelay: 300, delay: 600 },
} as const;

const ANCHOR_GAP = {
	spacious: 8,
	standard: 6,
} as const;

export type PopoverProps = PopoverBaseProps &
	PopoverStateProps &
	PopoverInteractionProps;

export function Popover({
	align = "center",
	anchorGap = "standard",
	children,
	defaultOpen,
	description,
	finalFocus = "trigger",
	focusMode = "nonmodal",
	hoverTiming = "standard",
	initialFocus = "auto",
	interaction = "click",
	onOpenChange,
	open,
	placement = "bottom",
	title,
	trigger,
	triggerLabel,
	variant = "default",
}: PopoverProps) {
	const [pinned, setPinned] = useState(false);
	const timing =
		interaction === "hover" ? HOVER_TIMING[hoverTiming] : undefined;
	const focusTarget =
		initialFocus === "first-field"
			? "input,textarea,select,[contenteditable='true']"
			: initialFocus;
	return (
		<BehaviorPopover
			closeDelay={timing?.closeDelay}
			defaultOpen={defaultOpen}
			delay={timing?.delay}
			modal={focusMode === "trap" ? "trap-focus" : false}
			onOpenChange={(nextOpen, details) => {
				if (!nextOpen || details.reason === "trigger-hover") setPinned(false);
				onOpenChange?.(nextOpen, interactionDetails(details));
			}}
			open={open}
			openOnHover={interaction === "hover"}
		>
			<PopoverTrigger
				aria-label={triggerLabel}
				data-slot="popover-trigger"
				onClick={() => {
					if (interaction === "hover") setPinned(true);
				}}
				render={trigger}
			/>
			<PopoverContent
				align={align}
				aria-label={title ? undefined : triggerLabel}
				data-has-heading={title || description ? "" : undefined}
				data-pinned={pinned || undefined}
				data-slot="popover-content"
				data-variant={variant}
				finalFocus={finalFocus}
				initialFocus={focusTarget}
				onPointerDown={() => {
					if (interaction === "hover") setPinned(true);
				}}
				side={placement}
				sideOffset={ANCHOR_GAP[anchorGap]}
			>
				{title || description ? (
					<div data-slot="popover-header">
						{title ? (
							<PopoverTitle data-slot="popover-title">{title}</PopoverTitle>
						) : null}
						{description ? (
							<PopoverDescription data-slot="popover-description">
								{description}
							</PopoverDescription>
						) : null}
					</div>
				) : null}
				<div data-slot="popover-body">{children}</div>
				{interaction === "hover" && pinned ? (
					<PopoverClose
						render={
							<IconButton
								icon={<XIcon aria-hidden="true" />}
								label="Close preview"
								size="small"
								variant="ghost"
							/>
						}
					/>
				) : null}
			</PopoverContent>
		</BehaviorPopover>
	);
}
