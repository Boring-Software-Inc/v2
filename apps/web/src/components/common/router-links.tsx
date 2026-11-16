import { createLink } from "@tanstack/react-router";
import { CardLink } from "@tripwire/ui/card";
import { ItemLink } from "@tripwire/ui/item";

export const ItemRouterLink = createLink(ItemLink);
export const CardRouterLink = createLink(CardLink);
