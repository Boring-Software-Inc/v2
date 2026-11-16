import { Button } from "@tripwire/ui/button";
import { Accordion } from "@tripwire/ui/collapsible";
import { Input } from "@tripwire/ui/field";
import { Icon, type IconGlyph, Search } from "@tripwire/ui/icon";
import type { InteractionDetails } from "@tripwire/ui/interaction";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@tripwire/ui/item";
import { type ComponentProps, type ReactNode, useState } from "react";
import { cn } from "#/lib/utils";

export interface PickerGroup<T> {
	key: string;
	title: string;
	icon: IconGlyph;
	items: T[];
}

export interface GroupedPickerProps<T> {
	groups: PickerGroup<T>[];
	noun: string;
	matches: (item: T, needle: string) => boolean;
	defaultOpen: string[];
	forceOpen?: boolean;
	autoFocus?: boolean;
	presentation?: "default" | "panel" | "disclosure";
	searchAppearance?: "compact-search";
	renderItem: (item: T) => ReactNode;
	renderFooter?: (group: PickerGroup<T>, allOpen: boolean) => ReactNode;
}

export function GroupedPicker<T>({
	groups,
	noun,
	matches,
	defaultOpen,
	forceOpen = false,
	autoFocus,
	presentation = "default",
	searchAppearance,
	renderItem,
	renderFooter,
}: GroupedPickerProps<T>) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<string[]>(defaultOpen);
	const needle = query.trim().toLowerCase();
	const searching = needle !== "";
	const visible = searching
		? groups
				.map((group) => ({
					...group,
					items: group.items.filter((item) => matches(item, needle)),
				}))
				.filter((group) => group.items.length > 0)
		: groups;
	const allOpen = searching || forceOpen;
	const label = `Search ${noun}`;
	const panel = presentation === "panel";
	const appearance = panel ? "compact-search" : searchAppearance;

	return (
		<div data-layout-role="grouped-picker" data-presentation={presentation}>
			<div
				className="flex shrink-0 items-center composition-gap-small tone-border-faint border-b"
				data-layout-role="grouped-picker-search"
			>
				<div className="min-w-0 flex-1">
					<Input
						appearance={appearance}
						ariaLabel={label}
						autoFocus={autoFocus}
						leadingIcon={
							appearance ? <Icon icon={Search} size={12} /> : undefined
						}
						onValueChange={setQuery}
						placeholder={label}
						type="search"
						value={query}
					/>
				</div>
			</div>
			<div
				className="min-h-0 flex-1 overflow-y-auto composition-bottom-standard"
				data-layout-role="grouped-picker-items"
			>
				{visible.length === 0 ? (
					<p
						className="content-body-small tone-content-secondary"
						data-layout-role="grouped-picker-empty"
					>
						No {noun} match “{query.trim()}”.
					</p>
				) : (
					<Accordion
						items={visible.map((group) => ({
							content: (
								<div
									className="flex flex-col composition-bottom-standard"
									data-layout-role="grouped-picker-rows"
								>
									{group.items.map((item) => renderItem(item))}
									{renderFooter?.(group, allOpen)}
								</div>
							),
							count: panel ? undefined : group.items.length,
							icon: group.icon,
							label: group.title,
							value: group.key,
						}))}
						multiple
						onValueChange={setOpen}
						value={allOpen ? visible.map((group) => group.key) : open}
						variant={
							panel
								? "sections"
								: presentation === "disclosure"
									? "disclosure"
									: "picker"
						}
					/>
				)}
			</div>
		</div>
	);
}

export type PickerRowProps = Omit<
	ComponentProps<typeof Item>,
	"children" | "density"
> & {
	icon: IconGlyph;
	name: string;
	description?: string;
	muted?: boolean;
	action?: ReactNode;
};

export function PickerRow({
	icon,
	name,
	description,
	muted = false,
	action,
	...props
}: PickerRowProps) {
	return (
		<Item density="compact" {...props}>
			<ItemMedia>
				<Icon icon={icon} tone={muted ? "disabled" : "secondary"} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span className="truncate">{name}</span>
				</ItemTitle>
				{description ? <ItemDescription>{description}</ItemDescription> : null}
			</ItemContent>
			{action ? (
				<ItemActions data-layout-role="picker-row-actions">
					{action}
				</ItemActions>
			) : null}
		</Item>
	);
}

export interface PickerRowActionProps {
	ariaLabel: string;
	disabled?: boolean;
	glyph: IconGlyph;
	onAction?: (details: InteractionDetails) => unknown;
	pending?: boolean;
	reveal: "hover" | "touch" | "always" | "never";
}

export function PickerRowAction({
	glyph,
	reveal,
	...props
}: PickerRowActionProps) {
	return (
		<span data-layout-role="picker-row-action">
			<Button size="small" variant="ghost" {...props}>
				<span
					className={cn(
						"transition-opacity duration-(--dur-state)",
						reveal !== "always" && "opacity-0",
						(reveal === "hover" || reveal === "touch") &&
							"pointer-coarse:opacity-100",
						reveal === "hover" &&
							"group-hover/item:opacity-100 picker-focus-visible",
					)}
				>
					<Icon icon={glyph} />
				</span>
			</Button>
		</span>
	);
}
