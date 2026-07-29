"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "#/lib/utils";

/** `accent` paints the checked track: the house blue, or brand for neutral use. */
type SwitchTone = "brand" | "accent";

function Switch({
	className,
	tone = "brand",
	...props
}: SwitchPrimitive.Root.Props & { tone?: SwitchTone }) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent shadow-xs outline-none transition-[background-color,box-shadow] data-unchecked:bg-input focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
				tone === "accent"
					? "data-checked:bg-accent-blue"
					: "data-checked:bg-brand",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={cn(
					"pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0",
				)}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
