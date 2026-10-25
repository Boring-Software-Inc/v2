import { type ComponentProps, type ReactNode, useState } from "react";
import { type GlazeIcon, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleGroup,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { Input } from "#/components/glaze/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { cn } from "#/lib/glaze/utils";

export interface PickerGroup<T> {
	key: string;
	title: string;
	icon: GlazeIcon;
	items: T[];
}

export interface GroupedPickerProps<T> {
	groups: PickerGroup<T>[];
	noun: string;
	matches: (item: T, needle: string) => boolean;
	defaultOpen: string[];
	forceOpen?: boolean;
	autoFocus?: boolean;
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

	return (
		<>
			<div className="flex shrink-0 items-center gap-1 border-line-faint border-b p-2">
				<Input
					aria-label={label}
					autoFocus={autoFocus}
					className="min-w-0 flex-1"
					mode="search"
					onValueChange={setQuery}
					placeholder={label}
					size="sm"
					value={query}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{visible.length === 0 ? (
					<p className="px-1 py-3 type-body-sm text-text-2">
						No {noun} match “{query.trim()}”.
					</p>
				) : (
					<CollapsibleGroup
						multiple
						onValueChange={(next) => setOpen(next as string[])}
						value={allOpen ? visible.map((group) => group.key) : open}
						variant="plain"
					>
						{visible.map((group) => (
							<Collapsible key={group.key} value={group.key}>
								<CollapsibleTrigger summary={String(group.items.length)}>
									<span className="inline-flex items-center gap-2">
										<Icon icon={group.icon} />
										{group.title}
									</span>
								</CollapsibleTrigger>
								<CollapsibleContent className="max-w-none pe-0 pb-2 group-data-[variant=plain]/collapsible-group:ps-2">
									<div className="flex flex-col">
										{group.items.map((item) => renderItem(item))}
									</div>
									{renderFooter?.(group, allOpen)}
								</CollapsibleContent>
							</Collapsible>
						))}
					</CollapsibleGroup>
				)}
			</div>
		</>
	);
}

export type PickerRowProps = Omit<
	ComponentProps<typeof Item>,
	"children" | "size"
> & {
	icon: GlazeIcon;
	name: string;
	muted?: boolean;
	action: ReactNode;
};

export function PickerRow({
	icon,
	name,
	muted = false,
	action,
	...props
}: PickerRowProps) {
	return (
		<Item size="sm" {...props}>
			<ItemMedia>
				<Icon
					className={muted ? "text-text-disabled" : "text-text-2"}
					icon={icon}
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span className="truncate">{name}</span>
				</ItemTitle>
			</ItemContent>
			<ItemActions className="static -me-3">{action}</ItemActions>
		</Item>
	);
}

export type PickerRowActionProps = Omit<
	ComponentProps<typeof Button>,
	"children" | "size" | "variant"
> & {
	glyph: GlazeIcon;
	reveal: "hover" | "touch" | "always" | "never";
};

export function PickerRowAction({
	glyph,
	reveal,
	className,
	...props
}: PickerRowActionProps) {
	return (
		<Button
			className={cn(
				"static after:absolute after:inset-0 after:content-['']",
				className,
			)}
			data-slot="item-link"
			size="icon-sm"
			variant="ghost"
			{...props}
		>
			<Icon
				className={cn(
					"transition-opacity duration-(--dur-state)",
					reveal !== "always" && "opacity-0",
					(reveal === "hover" || reveal === "touch") &&
						"pointer-coarse:opacity-100",
					reveal === "hover" &&
						"group-hover/item:opacity-100 group-has-[[data-slot=item-link]:focus-visible]/item:opacity-100",
				)}
				icon={glyph}
			/>
		</Button>
	);
}
