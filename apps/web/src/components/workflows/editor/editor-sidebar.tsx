import { useDraggable } from "@dnd-kit/core";
import { Link } from "@tanstack/react-router";
import type {
	EventKind,
	GateMode,
	JsonValue,
	WorkflowActionKind,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	RULE_CATALOG,
	TRIGGER_CATALOG,
} from "@tripwire/contracts";
import { useState } from "react";
import { Add, Close, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/glaze/ui/tabs";
import {
	hasEditableParams,
	PropertiesPanel,
} from "#/components/workflows/editor/properties-panel";
import { cn } from "#/lib/glaze/utils";

/**
 * The floating left sidebar — toolbox (catalog-driven palette, dnd-kit drag
 * sources + click-to-add) and properties (schema-driven editors for the
 * selected node). Properties is disabled without a selection or when the
 * selection has nothing to edit.
 */

export type ToolboxItem =
	| {
			id: string;
			kind: "trigger";
			name: string;
			description: string;
			eventKind: EventKind;
	  }
	| {
			id: string;
			kind: "rule";
			name: string;
			description: string;
			ref: string;
			defaultConfig: JsonValue;
	  }
	| {
			id: string;
			kind: "gate";
			name: string;
			description: string;
			mode: GateMode;
	  }
	| {
			id: string;
			kind: "action";
			name: string;
			description: string;
			action: WorkflowActionKind;
	  };

/** The palette, straight from the catalogs — never hardcode entries. */
export const TOOLBOX_SECTIONS: {
	title: string;
	kind: ToolboxItem["kind"];
	items: ToolboxItem[];
}[] = [
	{
		title: "Triggers",
		kind: "trigger",
		items: TRIGGER_CATALOG.filter((entry) => entry.toolbox).map((entry) => ({
			id: `trigger-${entry.kind}`,
			kind: "trigger" as const,
			name: entry.name,
			description: entry.description,
			eventKind: entry.kind,
		})),
	},
	{
		title: "Rules",
		kind: "rule",
		items: RULE_CATALOG.map((entry) => ({
			id: `rule-${entry.ruleId}@${entry.version}`,
			kind: "rule" as const,
			name: entry.name,
			description: entry.description,
			ref: `${entry.ruleId}@${entry.version}`,
			defaultConfig: entry.defaultConfig as JsonValue,
		})),
	},
	{
		title: "Gates",
		kind: "gate",
		items: GATE_CATALOG.map((entry) => ({
			id: `gate-${entry.mode}`,
			kind: "gate" as const,
			name: entry.name,
			description: entry.description,
			mode: entry.mode,
		})),
	},
	{
		title: "Actions",
		kind: "action",
		items: ACTION_CATALOG.map((entry) => ({
			id: `action-${entry.action}`,
			kind: "action" as const,
			name: entry.name,
			description: entry.description,
			action: entry.action,
		})),
	},
];

/** Build the workflow node a toolbox item inserts, with catalog defaults. */
export function buildNodeFromItem(item: ToolboxItem): WorkflowNode {
	const id = crypto.randomUUID();
	switch (item.kind) {
		case "trigger":
			return { id, type: "trigger", kinds: [item.eventKind] };
		case "rule":
			return {
				id,
				type: "rule",
				ref: item.ref,
				config: structuredClone(item.defaultConfig),
			};
		case "gate":
			return { id, type: "gate", mode: item.mode };
		case "action":
			return { id, type: "action", action: item.action };
		default:
			throw new Error("unknown toolbox item");
	}
}

export interface CustomToolboxRule {
	ref: string;
	name: string;
	description: string;
}

export interface EditorSidebarProps {
	/** The repo's custom rules; they join the rules section like built-ins. */
	customRules: CustomToolboxRule[];
	/** Route target for authoring a new rule (the rules page builder). */
	org: string;
	repo: string;
	readOnly: boolean;
	selectedNode: WorkflowNode | null;
	onAdd: (item: ToolboxItem) => void;
	onUpdateNode: (next: WorkflowNode) => void;
	onTestConnection: (
		url: string,
		kind: "webhook" | "discord",
	) => Promise<{ ok: boolean; status?: number; failure?: string }>;
}

export function EditorSidebar({
	customRules,
	org,
	repo,
	readOnly,
	selectedNode,
	onAdd,
	onUpdateNode,
	onTestConnection,
}: EditorSidebarProps) {
	const sections = TOOLBOX_SECTIONS.map((section) =>
		section.kind === "rule"
			? {
					...section,
					items: [
						...section.items,
						...customRules.map((rule) => ({
							id: `rule-${rule.ref}`,
							kind: "rule" as const,
							name: rule.name,
							description: rule.description,
							ref: rule.ref,
							defaultConfig: {} as JsonValue,
						})),
					],
				}
			: section,
	);
	const [tab, setTab] = useState<"toolbox" | "properties">("toolbox");
	const editable = selectedNode !== null && hasEditableParams(selectedNode);
	const [shown, setShown] = useState<"auto" | "open" | "closed">("auto");
	const addAndReveal = (item: ToolboxItem) => {
		onAdd(item);
		if (!window.matchMedia("(min-width: 768px)").matches) {
			setShown("auto");
		}
	};

	return (
		<>
			<Button
				className={cn(
					"absolute start-3 top-3 z-(--z-raised)",
					shown === "auto" && "md:hidden",
					shown === "open" && "hidden",
				)}
				onClick={() => setShown("open")}
				size="sm"
				variant="secondary"
			>
				{readOnly ? null : <Icon icon={Add} />}
				{readOnly ? "Show toolbox" : "Add steps"}
			</Button>
			<div
				className={cn(
					"shell absolute start-3 top-3 bottom-3 z-(--z-raised) w-64 flex-col gap-(--shell-inset)",
					shown === "auto" && "hidden md:flex",
					shown === "open" && "flex",
					shown === "closed" && "hidden",
				)}
			>
				<Tabs
					className="min-h-0 flex-1 gap-(--shell-inset)"
					onValueChange={(value) => setTab(value as "toolbox" | "properties")}
					value={tab}
				>
					<div className="flex items-center justify-between gap-2 px-1 pt-1">
						<TabsList aria-label="Editor sidebar" size="sm">
							<TabsTrigger value="toolbox">Toolbox</TabsTrigger>
							<TabsTrigger value="properties">Properties</TabsTrigger>
						</TabsList>
						<Button
							aria-label="Hide toolbox"
							onClick={() => setShown("closed")}
							size="icon-sm"
							variant="ghost"
						>
							<Icon icon={Close} />
						</Button>
					</div>
					<TabsContent
						className="panel min-h-0 overflow-y-auto p-2"
						value="toolbox"
					>
						<div className="flex flex-col gap-3">
							{sections.map((section) => (
								<section
									aria-labelledby={`toolbox-${section.kind}`}
									className="flex flex-col gap-1"
									key={section.title}
								>
									<h3
										className="px-1 type-label-sm text-text-2"
										id={`toolbox-${section.kind}`}
									>
										{section.title}
									</h3>
									<ItemGroup aria-label={section.title} variant="plain">
										{section.items.map((item) => (
											<ToolboxRow
												disabled={readOnly}
												item={item}
												key={item.id}
												onAdd={addAndReveal}
											/>
										))}
									</ItemGroup>
									{section.kind === "rule" ? (
										<Button
											className="self-start"
											nativeButton={false}
											render={
												<Link params={{ org, repo }} to="/$org/$repo/rules" />
											}
											size="sm"
											variant="ghost"
										>
											<Icon icon={Add} />
											Create rule
										</Button>
									) : null}
								</section>
							))}
						</div>
					</TabsContent>
					<TabsContent
						className="panel min-h-0 overflow-y-auto p-3"
						value="properties"
					>
						{selectedNode && editable ? (
							<PropertiesPanel
								key={selectedNode.id}
								node={selectedNode}
								onTestConnection={onTestConnection}
								onUpdate={onUpdateNode}
								readOnly={readOnly}
							/>
						) : (
							<p className="type-body-sm text-text-2">
								{selectedNode
									? "This step has no settings to change."
									: "Select one step on the canvas to see its settings."}
							</p>
						)}
					</TabsContent>
				</Tabs>
			</div>
		</>
	);
}

function ToolboxRow({
	item,
	disabled,
	onAdd,
}: {
	item: ToolboxItem;
	disabled: boolean;
	onAdd: (item: ToolboxItem) => void;
}) {
	const { listeners, setNodeRef, isDragging } = useDraggable({
		id: item.id,
		data: item,
		disabled,
	});
	return (
		<Item
			className={cn(!disabled && "cursor-grab", isDragging && "opacity-40")}
			disabled={disabled}
			ref={setNodeRef}
			size="sm"
			{...listeners}
		>
			<ItemContent>
				<ItemTitle>
					<span>{item.name}</span>
				</ItemTitle>
				<ItemDescription>{item.description}</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button
					aria-label={`Add ${item.name}`}
					disabled={disabled}
					onClick={() => onAdd(item)}
					size="icon-sm"
					variant="ghost"
				>
					<Icon icon={Add} />
				</Button>
			</ItemActions>
		</Item>
	);
}
