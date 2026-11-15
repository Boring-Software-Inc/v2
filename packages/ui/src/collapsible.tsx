import {
	AccordionHeader,
	AccordionItem,
	AccordionPanel,
	AccordionTrigger,
	Accordion as BehaviorAccordion,
} from "@ui-sdk/react/accordion";
import {
	Collapsible as BehaviorCollapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Icon, type IconGlyph } from "./icon";
import { type InteractionDetails, interactionDetails } from "./interaction";

interface CollapsibleOptions {
	as?: "div" | "li";
	children: ReactNode;
	disabled?: boolean;
	hiddenUntilFound?: boolean;
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	panelVariant?: "default" | "bordered";
	triggerTone?: "default" | "quiet";
}

type CollapsibleStateProps =
	| { defaultOpen?: boolean; open?: never }
	| { defaultOpen?: never; open: boolean };

export interface CollapsibleHeaderSlot {
	content: ReactNode;
	leading?: ReactNode;
	trailing?: ReactNode;
	trigger: ReactNode;
	triggerPosition?: "before-content" | "after-content";
}

export type CollapsibleProps = CollapsibleOptions &
	CollapsibleStateProps &
	(
		| {
				header: CollapsibleHeaderSlot;
				closedSummary?: never;
				summary?: never;
				variant?: never;
				trigger?: never;
		  }
		| {
				header?: never;
				closedSummary?: never;
				summary?: ReactNode;
				variant?: "default";
				trigger: ReactNode;
		  }
		| {
				closedSummary?: ReactNode;
				header?: never;
				summary?: never;
				trigger: ReactNode;
				variant: "compact";
		  }
	);

export function Collapsible({
	as = "div",
	children,
	closedSummary,
	defaultOpen,
	disabled,
	header,
	hiddenUntilFound,
	onOpenChange,
	open,
	panelVariant = "default",
	summary,
	trigger,
	triggerTone = "default",
	variant = "default",
}: CollapsibleProps) {
	const triggerContent = header?.trigger ?? trigger;
	const triggerView = (
		<CollapsibleTrigger data-slot="collapsible-trigger" data-tone={triggerTone}>
			{variant === "compact" ? (
				<>
					<span data-slot="collapsible-caret">
						<Icon icon={ChevronRight} size={12} tone="tertiary" />
					</span>
					<span data-slot="collapsible-label">{triggerContent}</span>
					{closedSummary === undefined ? null : (
						<span data-slot="collapsible-closed-summary">{closedSummary}</span>
					)}
				</>
			) : (
				triggerContent
			)}
		</CollapsibleTrigger>
	);
	return (
		<BehaviorCollapsible
			data-slot="collapsible"
			data-variant={variant}
			defaultOpen={defaultOpen}
			disabled={disabled}
			onOpenChange={(nextOpen, details) =>
				onOpenChange?.(nextOpen, interactionDetails(details))
			}
			open={open}
			render={as === "li" ? <li /> : undefined}
		>
			<div
				data-anatomy={header ? "header" : "simple"}
				data-slot="collapsible-summary"
			>
				{header ? (
					<>
						{header.leading ? (
							<div data-slot="collapsible-leading">{header.leading}</div>
						) : null}
						{header.triggerPosition !== "after-content" ? triggerView : null}
						<div data-slot="collapsible-summary-content">{header.content}</div>
						{header.triggerPosition === "after-content" ? triggerView : null}
						{header.trailing ? (
							<div data-slot="collapsible-trailing">{header.trailing}</div>
						) : null}
					</>
				) : (
					<>
						{triggerView}
						{summary === undefined ? null : (
							<div data-slot="collapsible-summary-content">{summary}</div>
						)}
					</>
				)}
			</div>
			<CollapsiblePanel
				data-slot="collapsible-panel"
				data-variant={panelVariant}
				hiddenUntilFound={hiddenUntilFound}
			>
				{children}
			</CollapsiblePanel>
		</BehaviorCollapsible>
	);
}

export interface AccordionItemData {
	count?: number;
	content: ReactNode;
	disabled?: boolean;
	icon?: IconGlyph;
	label: ReactNode;
	panelVariant?: "default" | "bordered";
	value: string;
}

interface AccordionOptions {
	disabled?: boolean;
	items: readonly AccordionItemData[];
	multiple?: boolean;
	onValueChange?: (value: string[], details: InteractionDetails) => void;
	variant?: "default" | "picker" | "sections" | "disclosure";
}

type AccordionStateProps =
	| { defaultValue?: string[]; value?: never }
	| { defaultValue?: never; value: string[] };

export type AccordionProps = AccordionOptions & AccordionStateProps;

export function Accordion({
	defaultValue,
	disabled,
	items,
	multiple = false,
	onValueChange,
	value,
	variant = "default",
}: AccordionProps) {
	return (
		<BehaviorAccordion
			collapsible
			data-slot="accordion"
			data-variant={variant}
			defaultValue={defaultValue}
			disabled={disabled}
			multiple={multiple}
			onValueChange={(nextValue, details) =>
				onValueChange?.(nextValue, interactionDetails(details))
			}
			value={value}
		>
			{items.map((item) => (
				<AccordionItem
					data-slot="accordion-item"
					disabled={item.disabled}
					key={item.value}
					value={item.value}
				>
					<AccordionHeader data-slot="accordion-header">
						<AccordionTrigger data-slot="accordion-trigger">
							{variant === "disclosure" ? (
								<span data-slot="accordion-caret">
									<Icon icon={ChevronRight} size={12} tone="tertiary" />
								</span>
							) : null}
							{item.icon ? (
								<span data-slot="accordion-heading">
									<Icon icon={item.icon} tone="secondary" />
									<span data-slot="accordion-label">{item.label}</span>
								</span>
							) : (
								<span data-slot="accordion-label">{item.label}</span>
							)}
							{item.count === undefined ? null : (
								<span data-slot="accordion-count">
									{item.count.toLocaleString()}
								</span>
							)}
							{variant === "sections" ? (
								<span data-slot="accordion-chevron">
									<Icon icon={ChevronDown} tone="secondary" />
								</span>
							) : null}
						</AccordionTrigger>
					</AccordionHeader>
					<AccordionPanel
						data-slot="accordion-panel"
						data-variant={item.panelVariant ?? "default"}
					>
						{item.content}
					</AccordionPanel>
				</AccordionItem>
			))}
		</BehaviorAccordion>
	);
}
