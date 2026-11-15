import {
	Tabs as BehaviorTabs,
	TabsIndicator,
	TabsList,
	TabsPanel,
	TabsTab,
} from "@ui-sdk/react/tabs";
import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "./button";
import { type InteractionDetails, interactionDetails } from "./interaction";

export interface TabItem {
	content?: ReactNode;
	count?: number;
	disabled?: boolean;
	hidden?: boolean;
	label: string;
	value: string;
}

export interface TabsAction {
	disabled?: boolean;
	label: string;
	onAction: (details: InteractionDetails) => unknown;
	value: string;
	variant?: Exclude<ButtonVariant, "destructive">;
}

interface TabsOptions {
	actions?: readonly TabsAction[];
	ariaLabel: string;
	size?: "small" | "medium";
	onValueChange?: (value: string | null, details: InteractionDetails) => void;
	panelMode?: "external" | "included";
	items: readonly TabItem[];
}

export type TabsProps = TabsOptions &
	(
		| { value: string | null; defaultValue?: never }
		| { value?: never; defaultValue?: string }
	);

export function Tabs({
	actions = [],
	ariaLabel,
	defaultValue,
	items,
	onValueChange,
	panelMode = "included",
	size = "medium",
	value,
}: TabsProps) {
	const visibleItems = items.filter((item) => !item.hidden);
	return (
		<BehaviorTabs
			data-size={size}
			data-slot="tabs"
			defaultValue={defaultValue}
			onValueChange={(nextValue, details) =>
				onValueChange?.(nextValue, interactionDetails(details))
			}
			value={value}
		>
			<div data-slot="tabs-header">
				<TabsList aria-label={ariaLabel} data-size={size} data-slot="tabs-list">
					<TabsIndicator data-slot="tabs-indicator" />
					{visibleItems.map((item) => (
						<TabsTab
							data-size={size}
							data-slot="tabs-tab"
							disabled={item.disabled}
							key={item.value}
							value={item.value}
						>
							{item.label}
							{item.count === undefined ? null : (
								<span data-slot="tabs-count">{item.count}</span>
							)}
						</TabsTab>
					))}
				</TabsList>
				{actions.length > 0 ? (
					<div data-slot="tabs-actions">
						{actions.map((action) => (
							<Button
								disabled={action.disabled}
								key={action.value}
								onAction={action.onAction}
								size="small"
								variant={action.variant}
							>
								{action.label}
							</Button>
						))}
					</div>
				) : null}
			</div>
			{panelMode === "included"
				? visibleItems.map((item) => (
						<TabsPanel
							data-slot="tabs-panel"
							key={item.value}
							value={item.value}
						>
							{item.content}
						</TabsPanel>
					))
				: null}
		</BehaviorTabs>
	);
}
