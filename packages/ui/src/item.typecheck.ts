import type { ComponentProps } from "react";
import type {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemLink,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "./item";

type ItemPart =
	| typeof Item
	| typeof ItemActions
	| typeof ItemContent
	| typeof ItemDescription
	| typeof ItemGroup
	| typeof ItemLink
	| typeof ItemMedia
	| typeof ItemMeta
	| typeof ItemTitle;

type AllowedChrome<Part extends ItemPart> = Part extends ItemPart
	? Extract<keyof ComponentProps<Part>, "className" | "style" | "color">
	: never;

export const itemChromeIsPrivate: AllowedChrome<ItemPart> extends never
	? true
	: false = true;

export const itemLinkSupportsNavigation: ComponentProps<typeof ItemLink> = {
	current: true,
	href: "/activity",
};
