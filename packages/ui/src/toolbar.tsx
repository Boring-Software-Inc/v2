import {
	Toolbar as BehaviorToolbar,
	ToolbarButton,
	ToolbarLink,
	ToolbarSeparator,
} from "@ui-sdk/react/toolbar";
import type { ReactNode } from "react";
import { type InteractionDetails, interactionFromEvent } from "./interaction";

export interface ToolbarAction {
	disabled?: boolean;
	label: ReactNode;
	onAction: (details: InteractionDetails) => unknown;
	type: "action";
	value: string;
}

export interface ToolbarLinkItem {
	href: string;
	label: ReactNode;
	type: "link";
	value: string;
}

export interface ToolbarSeparatorItem {
	type: "separator";
	value: string;
}

export type ToolbarItem =
	| ToolbarAction
	| ToolbarLinkItem
	| ToolbarSeparatorItem;

export interface ToolbarProps {
	ariaLabel: string;
	items: readonly ToolbarItem[];
	orientation?: "horizontal" | "vertical";
}

export function Toolbar({
	ariaLabel,
	items,
	orientation = "horizontal",
}: ToolbarProps) {
	return (
		<BehaviorToolbar
			aria-label={ariaLabel}
			data-slot="toolbar"
			orientation={orientation}
		>
			{items.map((item) => {
				switch (item.type) {
					case "separator":
						return (
							<ToolbarSeparator
								data-slot="toolbar-separator"
								key={item.value}
							/>
						);
					case "link":
						return (
							<ToolbarLink
								data-slot="toolbar-link"
								href={item.href}
								key={item.value}
							>
								{item.label}
							</ToolbarLink>
						);
					default:
						return (
							<ToolbarButton
								data-slot="toolbar-button"
								disabled={item.disabled}
								key={item.value}
								onClick={(event) =>
									item.onAction(interactionFromEvent(event.nativeEvent))
								}
							>
								{item.label}
							</ToolbarButton>
						);
				}
			})}
		</BehaviorToolbar>
	);
}
