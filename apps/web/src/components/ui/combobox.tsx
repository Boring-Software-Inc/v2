"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "#/lib/utils";

/**
 * The Base UI combobox, styled to the house pattern (mirrors dropdown-menu.tsx).
 * The Root is re-exported unwrapped so its generics survive. Everything visible
 * is a thin styled part. `ComboboxChipsInput` composes them into a chip field
 * that takes free text and, when given suggestions, offers them; it is the one
 * widget every list verb uses.
 */

const Combobox = ComboboxPrimitive.Root;
const ComboboxValue = ComboboxPrimitive.Value;

function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
	return (
		<ComboboxPrimitive.Chips
			data-slot="combobox-chips"
			className={cn(
				"flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-border bg-transparent px-1.5 py-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxChip({ className, ...props }: ComboboxPrimitive.Chip.Props) {
	return (
		<ComboboxPrimitive.Chip
			data-slot="combobox-chip"
			// A neutral filled pill: value chips are items in a list, not sentence
			// slots. Deliberately a different token from the surface-1 + ring
			// sentence chips so the two never read as the same thing.
			className={cn(
				"flex items-center gap-1 rounded bg-surface-2 py-0.5 pr-0.5 pl-1.5 text-[13px] outline-none data-highlighted:bg-surface-skeleton",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxChipRemove({
	className,
	...props
}: ComboboxPrimitive.ChipRemove.Props) {
	return (
		<ComboboxPrimitive.ChipRemove
			aria-label="Remove"
			data-slot="combobox-chip-remove"
			className={cn(
				"flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
				className,
			)}
			{...props}
		>
			<X className="size-3" />
		</ComboboxPrimitive.ChipRemove>
	);
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
	return (
		<ComboboxPrimitive.Input
			data-slot="combobox-input"
			className={cn(
				"min-w-16 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxContent({
	className,
	sideOffset = 6,
	align = "start",
	...props
}: ComboboxPrimitive.Popup.Props &
	Pick<ComboboxPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
	return (
		<ComboboxPrimitive.Portal>
			<ComboboxPrimitive.Positioner
				align={align}
				className="isolate z-50"
				sideOffset={sideOffset}
			>
				<ComboboxPrimitive.Popup
					data-slot="combobox-content"
					className={cn(
						"z-50 max-h-60 min-w-44 overflow-y-auto rounded-md border border-border bg-surface-1 p-1 shadow-md",
						className,
					)}
					{...props}
				/>
			</ComboboxPrimitive.Positioner>
		</ComboboxPrimitive.Portal>
	);
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
	return (
		<ComboboxPrimitive.Item
			data-slot="combobox-item"
			className={cn(
				"flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-[13px] outline-none data-highlighted:bg-surface-0",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
	return (
		<ComboboxPrimitive.Empty
			data-slot="combobox-empty"
			className={cn("px-2 py-1.5 text-[13px] text-muted-foreground", className)}
			{...props}
		/>
	);
}

/** Split raw text into trimmed, non-empty terms on commas and newlines. */
function splitTerms(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}

export interface ComboboxChipsInputProps {
	values: readonly string[];
	onValuesChange: (next: string[]) => void;
	placeholder?: string;
	/** Real repo values to offer; free text is always allowed alongside them. */
	suggestions?: readonly string[];
}

/**
 * A chip field on the Base UI combobox. Comma or Enter commits a chip, paste
 * splits on commas, Backspace on an empty input removes the last chip, and the x
 * removes a chip. When suggestions are passed they render as a filtered list;
 * anything typed is still accepted, since a branch can be named before it exists.
 */
export function ComboboxChipsInput({
	values,
	onValuesChange,
	placeholder,
	suggestions,
}: ComboboxChipsInputProps) {
	const [input, setInput] = React.useState("");

	const commit = (raw: string) => {
		const additions = splitTerms(raw).filter((term) => !values.includes(term));
		if (additions.length > 0) {
			onValuesChange([...values, ...additions]);
		}
		setInput("");
	};

	return (
		<Combobox
			inputValue={input}
			items={suggestions ?? []}
			multiple
			onInputValueChange={setInput}
			onValueChange={(next) => onValuesChange(next as string[])}
			value={values as string[]}
		>
			<ComboboxChips>
				{values.map((value) => (
					<ComboboxChip key={value}>
						{value}
						<ComboboxChipRemove />
					</ComboboxChip>
				))}
				<ComboboxInput
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === ",") {
							event.preventDefault();
							commit(input);
						} else if (
							event.key === "Backspace" &&
							input === "" &&
							values.length > 0
						) {
							onValuesChange(values.slice(0, -1));
						}
					}}
					onPaste={(event) => {
						const text = event.clipboardData.getData("text");
						if (text.includes(",") || text.includes("\n")) {
							event.preventDefault();
							commit(text);
						}
					}}
					placeholder={values.length === 0 ? placeholder : undefined}
				/>
			</ComboboxChips>
			{suggestions && suggestions.length > 0 ? (
				<ComboboxContent>
					<ComboboxPrimitive.List>
						{suggestions.map((suggestion) => (
							<ComboboxItem key={suggestion} value={suggestion}>
								{suggestion}
							</ComboboxItem>
						))}
					</ComboboxPrimitive.List>
					<ComboboxEmpty>no matches. press enter to add it.</ComboboxEmpty>
				</ComboboxContent>
			) : null}
		</Combobox>
	);
}

export {
	Combobox,
	ComboboxValue,
	ComboboxChips,
	ComboboxChip,
	ComboboxChipRemove,
	ComboboxInput,
	ComboboxContent,
	ComboboxItem,
	ComboboxEmpty,
};
