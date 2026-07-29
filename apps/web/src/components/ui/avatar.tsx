"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

import { cn } from "#/lib/utils";

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			className={cn(
				// A pure black/white hairline, never a tinted neutral — a tinted
				// outline picks up the surface behind it and reads as dirt on the edge.
				"relative flex size-8 shrink-0 overflow-hidden rounded-full outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
	return (
		<AvatarPrimitive.Image
			crossOrigin="anonymous"
			data-slot="avatar-image"
			className={cn("aspect-square size-full", className)}
			{...props}
		/>
	);
}

function AvatarFallback({
	className,
	...props
}: AvatarPrimitive.Fallback.Props) {
	return (
		<AvatarPrimitive.Fallback
			data-slot="avatar-fallback"
			className={cn(
				"flex size-full items-center justify-center rounded-full bg-muted",
				className,
			)}
			{...props}
		/>
	);
}

export { Avatar, AvatarImage, AvatarFallback };
