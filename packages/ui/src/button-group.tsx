import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useContext,
	useId,
} from "react";
import { type ButtonSize, IconButton } from "./button";
import { ChevronDown, Icon } from "./icon";
import { Menu, type MenuEntry } from "./menu";
import type { PopupAlign, PopupOffset, PopupPlacement } from "./popup";

const ButtonGroupAnchor = createContext<string | undefined>(undefined);

export interface ButtonGroupProps extends ComponentProps<"fieldset"> {
	orientation?: "horizontal" | "vertical";
}

export function ButtonGroup({
	"aria-label": ariaLabel = "Actions",
	orientation = "horizontal",
	...props
}: ButtonGroupProps) {
	const anchorId = useId();
	return (
		<ButtonGroupAnchor value={`[data-button-group-anchor="${anchorId}"]`}>
			<fieldset
				aria-label={ariaLabel}
				data-button-group-anchor={anchorId}
				data-orientation={orientation}
				data-slot="button-group"
				{...props}
			/>
		</ButtonGroupAnchor>
	);
}

export interface ButtonGroupMenuProps {
	align?: Exclude<PopupAlign, "center">;
	disabled?: boolean;
	icon?: ReactNode;
	items: readonly MenuEntry[];
	label: string;
	offset?: PopupOffset;
	pending?: boolean;
	placement?: PopupPlacement;
	size?: ButtonSize;
	variant?: "secondary" | "ghost";
}

export function ButtonGroupMenu({
	align = "end",
	disabled,
	icon,
	items,
	label,
	offset,
	pending,
	placement,
	size = "medium",
	variant = "secondary",
}: ButtonGroupMenuProps) {
	const anchor = useContext(ButtonGroupAnchor);
	return (
		<Menu
			align={align}
			anchor={anchor}
			ariaLabel={label}
			items={items}
			offset={offset ?? "compact"}
			placement={placement}
			size={size === "small" ? "small" : undefined}
			width={anchor ? "anchor" : undefined}
			trigger={
				<IconButton
					disabled={disabled}
					icon={
						icon ?? (
							<span data-slot="button-group-menu-chevron">
								<Icon icon={ChevronDown} />
							</span>
						)
					}
					label={label}
					pending={pending}
					size={size}
					variant={variant}
				/>
			}
		/>
	);
}
