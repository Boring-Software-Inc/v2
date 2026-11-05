import { createLink } from "@tanstack/react-router";
import { CardLink } from "#/design-system/ui/card";
import { ItemLink } from "#/design-system/ui/item";

export const ItemRouterLink = createLink(ItemLink);
export const CardRouterLink = createLink(CardLink);
