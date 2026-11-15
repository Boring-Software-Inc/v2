import { type ConfirmOptions, confirm } from "@ui-sdk/core/alert-dialog";
import {
	Menu as BehaviorMenu,
	MenuCheckboxItem,
	MenuContent,
	MenuGroup,
	MenuGroupLabel,
	MenuItem,
	MenuItemIcon,
	MenuItemIndicator,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
} from "@ui-sdk/react/menu";
import { type ReactElement, type ReactNode, useRef } from "react";
import type { AccessibleName } from "./accessible-name";
import { Badge, type BadgeTone, type BadgeVariant } from "./badge";
import { Check, Icon } from "./icon";
import {
	type InteractionDetails,
	interactionDetails,
	interactionFromEvent,
	shouldConfirmLocally,
} from "./interaction";
import {
	type PopupAlign,
	type PopupOffset,
	type PopupPlacement,
	popupOffsetValue,
} from "./popup";
import { Tooltip, type TooltipProps } from "./tooltip";

interface MenuItemBase {
	badge?: MenuBadge;
	description?: string;
	disabled?: boolean;
	icon?: ReactNode;
	label: string;
	metadata?: number | string;
	shortcut?: string;
	value: string;
}

export interface MenuBadge {
	label: string;
	tone?: BadgeTone;
	variant?: BadgeVariant;
}

interface NeutralMenuActionItem extends MenuItemBase {
	confirmation?: never;
	current?: boolean;
	onAction: (details: InteractionDetails) => unknown;
	tone?: "neutral";
	type?: "action";
}

interface DestructiveMenuActionItem extends MenuItemBase {
	confirmation: ConfirmOptions;
	current?: boolean;
	onAction: (details: InteractionDetails) => unknown;
	tone: "destructive";
	type?: "action";
}

export type MenuActionItem = NeutralMenuActionItem | DestructiveMenuActionItem;

export interface MenuLinkItem extends MenuItemBase {
	current?: boolean;
	href: string;
	onNavigate?: (href: string, details: InteractionDetails) => unknown;
	openInNewTab?: boolean;
	type: "link";
}

interface MenuCheckboxEntryBase extends Omit<MenuItemBase, "shortcut"> {
	onCheckedChange?: (checked: boolean, details: InteractionDetails) => unknown;
	type: "checkbox";
}

export type MenuCheckboxEntry = MenuCheckboxEntryBase &
	(
		| { checked: boolean; defaultChecked?: never }
		| { checked?: never; defaultChecked?: boolean }
	);

export interface MenuRadioOption extends Omit<MenuItemBase, "shortcut"> {}

interface MenuRadioGroupEntryBase {
	closeOnSelect?: boolean;
	label?: string;
	onValueChange?: (value: string, details: InteractionDetails) => unknown;
	options: readonly MenuRadioOption[];
	type: "radio-group";
	valueKey: string;
}

export type MenuRadioGroupEntry = MenuRadioGroupEntryBase &
	(
		| { defaultValue?: never; value: string }
		| { defaultValue?: string; value?: never }
	);

export interface MenuGroupEntry {
	items: readonly MenuEntry[];
	label: string;
	type: "group";
	value: string;
}

export interface MenuLabelEntry {
	label: string;
	type: "label";
	value: string;
}

export interface MenuSummaryEntry
	extends Omit<MenuItemBase, "disabled" | "shortcut"> {
	selected?: boolean;
	type: "summary";
	value: string;
}

export interface MenuSeparatorItem {
	type: "separator";
	value: string;
}

export type MenuEntry =
	| MenuActionItem
	| MenuCheckboxEntry
	| MenuGroupEntry
	| MenuLabelEntry
	| MenuLinkItem
	| MenuRadioGroupEntry
	| MenuSeparatorItem
	| MenuSummaryEntry;

interface MenuOptions {
	align?: PopupAlign;
	/** Position against this element selector while retaining the trigger for focus. */
	anchor?: string;
	items: readonly MenuEntry[];
	offset?: PopupOffset;
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	placement?: PopupPlacement;
	size?: "small" | "medium";
	trigger: ReactElement<object>;
	triggerTooltip?: Omit<TooltipProps, "trigger" | "open" | "defaultOpen">;
	/** Anchor width is a minimum, limited by the available viewport. */
	width?: "anchor" | "content" | "popover";
}

type MenuState =
	| { defaultOpen?: never; open: boolean }
	| { defaultOpen?: boolean; open?: never };

export type MenuProps = MenuOptions & AccessibleName & MenuState;

function ItemContent({ item }: { item: MenuItemBase }) {
	return (
		<>
			{item.icon ? (
				<MenuItemIcon data-slot="menu-item-icon">{item.icon}</MenuItemIcon>
			) : null}
			{item.description ? (
				<span data-slot="menu-item-copy">
					<span data-slot="menu-item-label-row">
						<span data-slot="menu-item-label">{item.label}</span>
						{item.badge ? (
							<Badge
								size="small"
								tone={item.badge.tone}
								variant={item.badge.variant ?? "outline"}
							>
								{item.badge.label}
							</Badge>
						) : null}
					</span>
					<span data-slot="menu-item-description">{item.description}</span>
				</span>
			) : (
				<span data-slot="menu-item-label-row">
					<span data-slot="menu-item-label">{item.label}</span>
					{item.badge ? (
						<Badge
							size="small"
							tone={item.badge.tone}
							variant={item.badge.variant ?? "outline"}
						>
							{item.badge.label}
						</Badge>
					) : null}
				</span>
			)}
			{item.metadata !== undefined ? (
				<span data-slot="menu-item-metadata">{item.metadata}</span>
			) : null}
			{"current" in item && item.current ? (
				<span aria-hidden="true" data-slot="menu-item-current">
					<Icon icon={Check} size={14} />
				</span>
			) : null}
		</>
	);
}

function renderEntry(
	item: MenuEntry,
	openSource: () => InteractionDetails["source"],
): ReactNode {
	switch (item.type) {
		case "separator":
			return <MenuSeparator data-slot="menu-separator" key={item.value} />;
		case "label":
			return (
				<div data-slot="menu-group-label" key={item.value} role="presentation">
					{item.label}
				</div>
			);
		case "summary":
			return (
				<div
					data-has-description={item.description ? "" : undefined}
					data-selected={item.selected ? "" : undefined}
					data-slot="menu-summary"
					key={item.value}
					role="presentation"
				>
					<ItemContent item={item} />
					{item.selected ? (
						<span aria-hidden="true" data-slot="menu-summary-check">
							<Icon icon={Check} size={14} />
						</span>
					) : null}
				</div>
			);
		case "group":
			return (
				<MenuGroup data-slot="menu-group" key={item.value}>
					<MenuGroupLabel data-slot="menu-group-label">
						{item.label}
					</MenuGroupLabel>
					{item.items.map((entry) => renderEntry(entry, openSource))}
				</MenuGroup>
			);
		case "checkbox":
			return (
				<MenuCheckboxItem
					checked={item.checked}
					data-has-description={item.description ? "" : undefined}
					data-slot="menu-checkbox-item"
					defaultChecked={item.defaultChecked}
					disabled={item.disabled}
					key={item.value}
					label={item.label}
					onCheckedChange={(checked, details) =>
						item.onCheckedChange?.(checked, interactionDetails(details))
					}
					value={item.value}
				>
					<MenuItemIndicator data-slot="menu-item-indicator">
						<Icon icon={Check} size={14} />
					</MenuItemIndicator>
					<ItemContent item={item} />
				</MenuCheckboxItem>
			);
		case "radio-group":
			return (
				<MenuRadioGroup
					data-slot="menu-radio-group"
					defaultValue={item.defaultValue}
					key={item.valueKey}
					name={item.valueKey}
					onValueChange={(value, details) =>
						item.onValueChange?.(value, interactionDetails(details))
					}
					value={item.value}
				>
					{item.label ? (
						<MenuGroupLabel data-slot="menu-group-label">
							{item.label}
						</MenuGroupLabel>
					) : null}
					{item.options.map((option) => (
						<MenuRadioItem
							closeOnSelect={item.closeOnSelect}
							data-has-description={option.description ? "" : undefined}
							data-slot="menu-radio-item"
							disabled={option.disabled}
							key={option.value}
							label={option.label}
							value={option.value}
						>
							<MenuItemIndicator data-slot="menu-item-indicator">
								<Icon icon={Check} size={14} />
							</MenuItemIndicator>
							<ItemContent item={option} />
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			);
		case "link":
			return (
				<MenuItem
					aria-current={item.current ? "page" : undefined}
					data-has-description={item.description ? "" : undefined}
					data-slot="menu-item"
					disabled={item.disabled}
					key={item.value}
					label={item.label}
					onSelect={(event) => {
						if (!item.onNavigate) return;
						event.preventDefault();
						return item.onNavigate(
							item.href,
							interactionFromEvent(event, openSource()),
						);
					}}
					render={
						<a
							aria-label={item.label}
							href={item.href}
							rel={item.openInNewTab ? "noreferrer" : undefined}
							target={item.openInNewTab ? "_blank" : undefined}
						>
							<ItemContent item={item} />
						</a>
					}
					shortcut={item.shortcut}
					value={item.value}
				/>
			);
		default:
			return (
				<MenuItem
					aria-current={item.current ? "page" : undefined}
					data-agent-confirm={item.confirmation?.title}
					data-has-description={item.description ? "" : undefined}
					data-slot="menu-item"
					data-tone={item.tone ?? "neutral"}
					destructive={item.tone === "destructive"}
					disabled={item.disabled}
					key={item.value}
					label={item.label}
					onSelect={(event) => {
						const details = interactionFromEvent(event, openSource());
						if (
							item.tone === "destructive" &&
							shouldConfirmLocally(details.source)
						) {
							return confirm(item.confirmation).then((accepted) =>
								accepted ? item.onAction(details) : undefined,
							);
						}
						return item.onAction(details);
					}}
					shortcut={item.shortcut}
					value={item.value}
				>
					<ItemContent item={item} />
				</MenuItem>
			);
	}
}

export function Menu({
	align = "center",
	anchor,
	ariaLabel,
	ariaLabelledBy,
	defaultOpen,
	items,
	offset = "standard",
	onOpenChange,
	open,
	placement = "bottom",
	size = "medium",
	trigger,
	triggerTooltip,
	width = "content",
}: MenuProps) {
	const openSource = useRef<InteractionDetails["source"]>("programmatic");
	const menuTrigger = (
		<MenuTrigger
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			data-slot="menu-trigger"
			render={trigger}
		/>
	);
	return (
		<BehaviorMenu
			defaultOpen={defaultOpen}
			onOpenChange={(nextOpen, details) => {
				if (nextOpen) openSource.current = details.source;
				onOpenChange?.(nextOpen, interactionDetails(details));
			}}
			open={open}
		>
			{triggerTooltip ? (
				<Tooltip {...triggerTooltip} trigger={menuTrigger} />
			) : (
				menuTrigger
			)}
			<MenuContent
				align={align}
				anchor={anchor}
				data-size={size}
				data-width={width}
				side={placement}
				sideOffset={popupOffsetValue(offset)}
			>
				{items.map((item) => renderEntry(item, () => openSource.current))}
			</MenuContent>
		</BehaviorMenu>
	);
}
