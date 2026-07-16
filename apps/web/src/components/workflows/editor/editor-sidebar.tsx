import { useDraggable } from "@dnd-kit/core";
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
export const TOOLBOX_SECTIONS: { title: string; items: ToolboxItem[] }[] = [
	{
		title: "triggers",
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

export interface EditorSidebarProps {
	readOnly: boolean;
	selectedNode: WorkflowNode | null;
	onAdd: (item: ToolboxItem) => void;
	onUpdateNode: (next: WorkflowNode) => void;
}

export function EditorSidebar({
	readOnly,
	selectedNode,
	onAdd,
	onUpdateNode,
}: EditorSidebarProps) {
	const [tab, setTab] = useState<"toolbox" | "properties">("toolbox");
	const propertiesDisabled =
		selectedNode === null || !hasEditableParams(selectedNode);
	const activeTab = propertiesDisabled ? "toolbox" : tab;

	return (
		<div className="absolute top-3 bottom-3 left-3 z-10 flex w-60 flex-col overflow-hidden rounded-lg border bg-card/95 shadow-md backdrop-blur">
			<div className="flex shrink-0 gap-1 border-b p-1.5">
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
					<div className="flex flex-col gap-3">
						{TOOLBOX_SECTIONS.map((section) => (
							<div key={section.title}>
								<p className="mb-1 px-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
									{section.title}
								</p>
								<div className="flex flex-col gap-1">
									{section.items.map((item) => (
										<ToolboxRow
											disabled={readOnly}
											item={item}
											key={item.id}
											onAdd={onAdd}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				) : selectedNode ? (
					<PropertiesPanel
						key={selectedNode.id}
						node={selectedNode}
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
	return (
		<button
			className={cn(
				"w-full rounded-md border bg-card px-2 py-1.5 text-left transition-colors",
				disabled
					? "cursor-not-allowed opacity-50"
					: "cursor-grab hover:bg-surface-1",
				isDragging && "opacity-40",
			)}
			disabled={disabled}
			onClick={() => onAdd(item)}
			ref={setNodeRef}
			type="button"
			{...listeners}
			{...attributes}
		>
			<span className="block text-xs">{item.name}</span>
			<span className="block text-[11px] text-muted-foreground leading-4">
				{item.description}
			</span>
		</button>
	);
}
