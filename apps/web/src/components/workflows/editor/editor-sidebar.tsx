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
import { KIND_STYLES } from "#/components/workflows/editor/node-kind-styles";
import {
	hasEditableParams,
	PropertiesPanel,
} from "#/components/workflows/editor/properties-panel";
import { cn } from "#/lib/utils";

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
		title: "triggers",
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
		title: "rules",
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
		title: "gates",
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
		title: "actions",
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
	const propertiesDisabled =
		selectedNode === null || !hasEditableParams(selectedNode);
	const activeTab = propertiesDisabled ? "toolbox" : tab;

	return (
		<div className="absolute top-3 bottom-3 left-3 z-10 flex w-64 flex-col overflow-hidden rounded-xl border bg-surface-0/95 shadow-md backdrop-blur">
			<div className="flex shrink-0 gap-1 p-1.5 pb-0">
				<button
					className={cn(
						"flex-1 rounded-md px-2 py-1 font-medium text-xs transition-colors",
						activeTab === "toolbox"
							? "bg-surface-1 text-foreground"
							: "text-muted-foreground hover:bg-surface-1",
					)}
					onClick={() => setTab("toolbox")}
					type="button"
				>
					toolbox
				</button>
				<button
					className={cn(
						"flex-1 rounded-md px-2 py-1 font-medium text-xs transition-colors",
						activeTab === "properties"
							? "bg-surface-1 text-foreground"
							: "text-muted-foreground",
						propertiesDisabled
							? "cursor-not-allowed opacity-40"
							: "hover:bg-surface-1",
					)}
					disabled={propertiesDisabled}
					onClick={() => setTab("properties")}
					type="button"
				>
					properties
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{activeTab === "toolbox" ? (
					<div className="flex flex-col gap-2.5">
						{sections.map((section) => (
							<div
								className="overflow-hidden rounded-xl border bg-card"
								key={section.title}
							>
								<div className="bg-surface-1 px-3 py-2">
									<p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
										{section.title}
									</p>
								</div>
								<div className="divide-y divide-border/60">
									{section.items.map((item) => (
										<ToolboxRow
											disabled={readOnly}
											item={item}
											key={item.id}
											onAdd={onAdd}
										/>
									))}
									{section.kind === "rule" ? (
										<Link
											className="block px-3 py-2 font-medium text-primary text-xs hover:bg-surface-1"
											params={{ org, repo }}
											to="/$org/$repo/rules"
										>
											create rule →
										</Link>
									) : null}
								</div>
							</div>
						))}
					</div>
				) : selectedNode ? (
					<PropertiesPanel
						key={selectedNode.id}
						node={selectedNode}
						onTestConnection={onTestConnection}
						onUpdate={onUpdateNode}
						readOnly={readOnly}
					/>
				) : null}
			</div>
		</div>
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
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: item.id,
		data: item,
		disabled,
	});
	const style = KIND_STYLES[item.kind];
	return (
		<button
			className={cn(
				"w-full border-l-2 border-l-transparent px-3 py-2 text-left transition-colors",
				disabled
					? "cursor-not-allowed opacity-50"
					: cn("cursor-grab hover:bg-surface-1", style.hoverAccent),
				isDragging && "opacity-40",
			)}
			disabled={disabled}
			onClick={() => onAdd(item)}
			ref={setNodeRef}
			type="button"
			{...listeners}
			{...attributes}
		>
			<span className="flex items-center gap-1.5 text-xs">
				<span className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
				{item.name}
			</span>
			<span className="mt-0.5 block text-[11px] text-muted-foreground leading-4">
				{item.description}
			</span>
		</button>
	);
}
