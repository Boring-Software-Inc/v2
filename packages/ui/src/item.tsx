import { type ComponentProps, createContext, useContext } from "react";

type ItemElementProps<Tag extends "a" | "div"> = Omit<
	ComponentProps<Tag>,
	"className" | "style" | "color"
>;

const ItemGroupContext = createContext(false);

export interface ItemProps extends ItemElementProps<"div"> {
	disabled?: boolean;
	density?: "compact" | "default";
	inset?: boolean;
	selected?: boolean;
}

export function Item({
	disabled = false,
	density = "default",
	inset = false,
	selected = false,
	...props
}: ItemProps) {
	const inGroup = useContext(ItemGroupContext);
	return (
		<div
			aria-disabled={disabled || undefined}
			data-density={density}
			data-disabled={disabled || undefined}
			data-inset={inset || undefined}
			data-selected={selected || undefined}
			data-slot="item"
			role={inGroup ? "listitem" : undefined}
			{...props}
		/>
	);
}

export interface ItemGroupProps extends ItemElementProps<"div"> {
	variant?: "panel" | "plain";
}

export function ItemGroup({
	role = "list",
	variant = "panel",
	...props
}: ItemGroupProps) {
	return (
		<ItemGroupContext value>
			<div
				data-slot="item-group"
				data-variant={variant}
				role={role}
				{...props}
			/>
		</ItemGroupContext>
	);
}

export interface ItemMediaProps extends ItemElementProps<"div"> {
	variant?: "default" | "icon" | "image";
}

export function ItemMedia({ variant = "default", ...props }: ItemMediaProps) {
	return <div data-slot="item-media" data-variant={variant} {...props} />;
}

export function ItemContent(props: ItemElementProps<"div">) {
	return <div data-slot="item-content" {...props} />;
}

export function ItemTitle(props: ItemElementProps<"div">) {
	return <div data-slot="item-title" {...props} />;
}

export function ItemDescription(props: ItemElementProps<"div">) {
	return <div data-slot="item-description" {...props} />;
}

export function ItemMeta(props: ItemElementProps<"div">) {
	return <div data-slot="item-meta" {...props} />;
}

export function ItemActions(props: ItemElementProps<"div">) {
	return <div data-slot="item-actions" {...props} />;
}

export interface ItemLinkProps extends ItemElementProps<"a"> {
	current?: boolean;
	disabled?: boolean;
}

export function ItemLink({
	current = false,
	disabled = false,
	href,
	...props
}: ItemLinkProps) {
	return (
		<a
			aria-current={current ? "page" : undefined}
			aria-disabled={disabled || undefined}
			data-slot="item-link"
			href={disabled ? undefined : href}
			{...props}
		/>
	);
}
