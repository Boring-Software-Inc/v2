"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";

import { cn } from "#/lib/utils";

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
	return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
	className,
	sideOffset = 6,
	side,
	align,
	alignOffset,
	...props
}: MenuPrimitive.Popup.Props &
	Pick<
		MenuPrimitive.Positioner.Props,
		"side" | "sideOffset" | "align" | "alignOffset"
	>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className="isolate z-50"
				side={side}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						"z-50 min-w-44 overflow-hidden rounded-md border border-border bg-surface-1 p-1 shadow-md",
						className,
					)}
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
	return (
		<MenuPrimitive.Item
			data-slot="dropdown-menu-item"
			className={cn(
				"flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-highlighted:bg-surface-0",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Non-interactive heading text inside the menu. Base UI's GroupLabel must
 * live inside a Group; radix's Label was a plain div, and this stays one so
 * existing free-floating usage keeps its exact semantics.
 */
function DropdownMenuLabel({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dropdown-menu-label"
			className={cn("px-2 py-1.5 text-[13px]", className)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: MenuPrimitive.Separator.Props) {
	return (
		<MenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
};
