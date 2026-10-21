import { createLink } from "@tanstack/react-router";
import { CardLink } from "#/components/glaze/ui/card";
import { ItemLink } from "#/components/glaze/ui/item";

export const ItemRouterLink = createLink(ItemLink);
export const CardRouterLink = createLink(CardLink);
