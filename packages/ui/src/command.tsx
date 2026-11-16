import { type ConfirmOptions, confirm } from "@ui-sdk/core/alert-dialog";
import {
	Command as BehaviorCommand,
	CommandEmpty,
	CommandGroup,
	CommandGroupLabel,
	CommandInput,
	CommandItem,
	CommandItemIcon,
	CommandItemText,
	CommandList,
	CommandSeparator,
	CommandShortcut,
	CommandStatus,
} from "@ui-sdk/react/command";
import {
	Dialog as BehaviorDialog,
	DialogBackdrop,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@ui-sdk/react/dialog";
import {
	createElement,
	type ReactElement,
	type ReactNode,
	type Ref,
} from "react";
import { Badge, type BadgeTone, type BadgeVariant } from "./badge";
import { Check, Icon, Search } from "./icon";
import {
	type InteractionDetails,
	interactionDetails,
	interactionFromEvent,
	shouldConfirmLocally,
} from "./interaction";
import { Kbd } from "./kbd";
import { OverlayPortal } from "./overlay-portal";

interface CommandItemBase {
	badge?: string;
	current?: boolean;
	disabled?: boolean;
	icon?: ReactNode;
	keywords?: readonly string[];
	label: string;
	labelBadge?: CommandBadgeData;
	shortcut?: string;
	statusBadges?: readonly CommandBadgeData[];
	value: string;
}

export interface CommandBadgeData {
	label: string;
	tone?: BadgeTone;
	variant?: BadgeVariant;
}

interface NeutralCommandActionItem extends CommandItemBase {
	agentConfirmation?: string;
	confirmation?: never;
	onAction: (details: InteractionDetails) => unknown;
	tone?: "neutral";
	type?: "action";
}

interface DestructiveCommandActionItem extends CommandItemBase {
	confirmation: ConfirmOptions;
	onAction: (details: InteractionDetails) => unknown;
	tone: "destructive";
	type?: "action";
}

export type CommandItemData =
	| DestructiveCommandActionItem
	| NeutralCommandActionItem;

export interface CommandLinkItem extends CommandItemBase {
	href: string;
	onNavigate?: (href: string, details: InteractionDetails) => unknown;
	type: "link";
}

export interface CommandGroupData {
	items: readonly CommandLeafItem[];
	label: string;
	showLabel?: boolean;
	type: "group";
}

export interface CommandSeparatorData {
	id: string;
	type: "separator";
}

export interface CommandContentData {
	content: ReactNode;
	id: string;
	type: "content";
}

export type CommandLeafItem = CommandItemData | CommandLinkItem;
export type CommandEntry =
	| CommandLeafItem
	| CommandContentData
	| CommandGroupData
	| CommandSeparatorData;

export interface CommandFooterHint {
	key: string;
	label: string;
}

interface CommandBaseProps {
	ariaLabel: string;
	autoFocus?: boolean;
	emptyContent?: ReactNode;
	emptyLabel?: string;
	filter?:
		| "contains"
		| "fuzzy"
		| "startsWith"
		| ((item: CommandLeafItem, query: string) => boolean | number);
	footerHints?: readonly CommandFooterHint[];
	footerResultCount?: number;
	inputRef?: Ref<HTMLInputElement>;
	items: readonly CommandEntry[];
	loading?: boolean;
	loadingContent?: ReactNode;
	onQueryChange?: (query: string, details: InteractionDetails) => void;
	placeholder?: string;
}

type CommandQueryState =
	| {
			defaultQuery?: string;
			query?: never;
	  }
	| {
			defaultQuery?: never;
			query: string;
	  };

export type CommandProps = CommandBaseProps & CommandQueryState;

function leaves(items: readonly CommandEntry[]) {
	return items.flatMap((item) =>
		item.type === "group"
			? item.items
			: item.type === "separator" || item.type === "content"
				? []
				: [item],
	);
}

export function Command({
	ariaLabel,
	autoFocus,
	defaultQuery,
	emptyContent,
	emptyLabel = "No results",
	filter,
	footerHints,
	footerResultCount,
	inputRef,
	items,
	loading = false,
	loadingContent = "Loading results",
	onQueryChange,
	placeholder,
	query,
}: CommandProps) {
	const leafItems = leaves(items);
	const itemsByValue = new Map<string, CommandLeafItem>();
	for (const item of leafItems) {
		if (itemsByValue.has(item.value)) {
			throw new Error(`Command item values must be unique: "${item.value}"`);
		}
		itemsByValue.set(item.value, item);
	}
	const adaptedFilter =
		filter === undefined ||
		filter === "contains" ||
		filter === "fuzzy" ||
		filter === "startsWith"
			? filter
			: (item: { value: string }, query: string) => {
					const entry = itemsByValue.get(item.value);
					return entry ? filter(entry, query) : false;
				};

	return (
		<BehaviorCommand
			data-slot="command"
			defaultQuery={defaultQuery}
			filter={adaptedFilter}
			onAction={(nextValue, details) => {
				const item = itemsByValue.get(nextValue);
				if (!item) return;
				const interaction =
					details.event?.type === "click" && !details.event.isTrusted
						? ({ source: "agent" } as const)
						: interactionFromEvent(details.event);
				if (item.type === "link") {
					return item.onNavigate?.(item.href, interaction);
				}
				if (
					item.tone === "destructive" &&
					shouldConfirmLocally(interaction.source)
				) {
					return confirm(item.confirmation).then((accepted) => {
						if (accepted) return item.onAction(interaction);
					});
				}
				return item.onAction(interaction);
			}}
			onQueryChange={(query, details) =>
				onQueryChange?.(query, interactionDetails(details))
			}
			query={query}
			status={loading ? "loading" : "idle"}
		>
			<div data-slot="command-panel">
				<div data-slot="command-input-wrapper">
					<Icon icon={Search} tone="secondary" />
					<CommandInput
						aria-label={ariaLabel}
						autoFocus={autoFocus}
						data-slot="command-input"
						placeholder={placeholder}
						ref={inputRef}
					/>
				</div>
				<CommandStatus data-slot="command-status">
					{loading ? loadingContent : null}
				</CommandStatus>
				<CommandList data-slot="command-list">
					{loading
						? null
						: items.map((item) => {
								if (item.type === "separator") {
									return (
										<CommandSeparator
											data-slot="command-separator"
											key={item.id}
										/>
									);
								}
								if (item.type === "content") {
									return (
										<div data-slot="command-content" key={item.id}>
											{item.content}
										</div>
									);
								}
								if (item.type === "group") {
									return (
										<CommandGroup
											aria-label={item.label}
											data-slot="command-group"
											key={item.label}
										>
											{item.showLabel === false ? null : (
												<CommandGroupLabel data-slot="command-group-label">
													{item.label}
												</CommandGroupLabel>
											)}
											{item.items.map(renderItem)}
										</CommandGroup>
									);
								}
								return renderItem(item);
							})}
				</CommandList>
				{loading ? null : (
					<CommandEmpty data-slot="command-empty">
						{emptyContent ?? emptyLabel}
					</CommandEmpty>
				)}
			</div>
			{footerHints?.length || footerResultCount !== undefined ? (
				<footer data-slot="command-footer">
					{footerHints?.map((hint) => (
						<span
							data-slot="command-footer-hint"
							key={`${hint.key}-${hint.label}`}
						>
							<Kbd>{hint.key}</Kbd>
							{hint.label}
						</span>
					))}
					{footerResultCount === undefined ? null : (
						<span data-slot="command-footer-count">
							{footerResultCount}{" "}
							{footerResultCount === 1 ? "result" : "results"}
						</span>
					)}
				</footer>
			) : null}
		</BehaviorCommand>
	);
}

function renderItem(item: CommandLeafItem) {
	return (
		<CommandItem
			aria-current={item.current ? "page" : undefined}
			data-agent-confirm={
				item.type === "link"
					? undefined
					: item.tone === "destructive"
						? item.confirmation.title
						: item.agentConfirmation
			}
			data-slot="command-item"
			data-tone={item.type === "link" ? "neutral" : (item.tone ?? "neutral")}
			disabled={item.disabled}
			key={item.value}
			keywords={item.keywords ? [...item.keywords] : undefined}
			label={item.label}
			render={
				item.type === "link" ? (
					createElement("a", { href: item.href })
				) : (
					<button type="button" />
				)
			}
			shortcut={item.shortcut}
			value={item.value}
		>
			{item.icon ? (
				<CommandItemIcon data-slot="command-item-icon">
					{item.icon}
				</CommandItemIcon>
			) : null}
			<span data-slot="command-item-copy">
				<CommandItemText data-slot="command-item-text">
					{item.label}
				</CommandItemText>
				{item.labelBadge ? (
					<Badge
						data-slot="command-item-label-badge"
						size="small"
						tone={item.labelBadge.tone}
						variant={item.labelBadge.variant}
					>
						{item.labelBadge.label}
					</Badge>
				) : null}
			</span>
			{item.statusBadges?.length || item.badge || item.current ? (
				<span data-slot="command-item-status">
					{item.statusBadges?.map((badge) => (
						<Badge
							key={`${badge.label}-${badge.tone ?? "neutral"}-${badge.variant ?? "solid"}`}
							size="small"
							tone={badge.tone}
							variant={badge.variant}
						>
							{badge.label}
						</Badge>
					))}
					{item.badge ? (
						<span data-slot="command-item-badge">{item.badge}</span>
					) : null}
					{item.current ? <Icon icon={Check} label="Current" /> : null}
				</span>
			) : null}
			{item.shortcut ? <CommandShortcut shortcut={item.shortcut} /> : null}
		</CommandItem>
	);
}

interface CommandDialogBaseProps {
	finalFocus?: () => HTMLElement | null;
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	title: string;
	trigger?: ReactElement<object>;
}

type CommandDialogState =
	| {
			defaultOpen?: boolean;
			open?: never;
	  }
	| {
			defaultOpen?: never;
			open: boolean;
	  };

export type CommandDialogProps = CommandProps &
	CommandDialogBaseProps &
	CommandDialogState;

export function CommandDialog({
	defaultOpen,
	finalFocus,
	onOpenChange,
	open,
	title,
	trigger,
	...command
}: CommandDialogProps) {
	return (
		<BehaviorDialog
			defaultOpen={defaultOpen}
			onOpenChange={(nextOpen, details) =>
				onOpenChange?.(nextOpen, interactionDetails(details))
			}
			open={open}
		>
			{trigger ? (
				<DialogTrigger data-slot="command-dialog-trigger" render={trigger} />
			) : null}
			<OverlayPortal>
				<DialogBackdrop data-slot="dialog-backdrop" />
				<DialogContent data-command-dialog="" finalFocus={finalFocus}>
					<DialogTitle className="ui-sr-only">{title}</DialogTitle>
					<Command {...command} />
				</DialogContent>
			</OverlayPortal>
		</BehaviorDialog>
	);
}
