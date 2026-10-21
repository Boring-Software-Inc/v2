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
import { Add, ArrowLeft, Close, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleGroup,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { Input } from "#/components/glaze/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import {
	hasEditableParams,
	PropertiesPanel,
} from "#/components/workflows/editor/properties-panel";
import {
	actionIcon,
	gateIcon,
	KIND_ICON,
	KIND_LABEL,
	ruleIcon,
	stepIcon,
	stepName,
	triggerIcon,
} from "#/components/workflows/editor/step-meta";
import { cn } from "#/lib/glaze/utils";

/**
 * The floating left sidebar. With nothing selected it is the toolbox
 * (catalog-driven palette, dnd-kit drag sources + click-to-add); with one step
 * selected it is that step's properties (schema-driven editors).
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
	onClearSelection: () => void;
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
	onClearSelection,
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
	const [shown, setShown] = useState<"auto" | "open" | "closed">("auto");
	const addAndReveal = (item: ToolboxItem) => {
		onAdd(item);
		if (!window.matchMedia("(min-width: 768px)").matches) {
			setShown("auto");
		}
	};
	const customName =
		selectedNode?.type === "rule"
			? (customRules.find((rule) => rule.ref === selectedNode.ref)?.name ??
				null)
			: null;

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
					"shell absolute start-3 top-3 bottom-3 z-(--z-raised) w-68 flex-col",
					shown === "auto" && "hidden md:flex",
					shown === "open" && "flex",
					shown === "closed" && "hidden",
				)}
			>
				<div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
					{selectedNode ? (
						<StepProperties
							customName={customName}
							key={selectedNode.id}
							node={selectedNode}
							onBack={onClearSelection}
							onTestConnection={onTestConnection}
							onUpdate={onUpdateNode}
							readOnly={readOnly}
						/>
					) : (
						<Toolbox
							onAdd={addAndReveal}
							onHide={() => setShown("closed")}
							org={org}
							readOnly={readOnly}
							repo={repo}
							sections={sections}
						/>
					)}
				</div>
			</div>
		</>
	);
}

type ToolboxSection = (typeof TOOLBOX_SECTIONS)[number];

const OPEN_BY_DEFAULT: ToolboxItem["kind"][] = ["trigger", "rule"];

function matches(item: ToolboxItem, needle: string): boolean {
	return `${item.name} ${item.description}`.toLowerCase().includes(needle);
}

function Toolbox({
	sections,
	readOnly,
	org,
	repo,
	onAdd,
	onHide,
}: {
	sections: ToolboxSection[];
	readOnly: boolean;
	org: string;
	repo: string;
	onAdd: (item: ToolboxItem) => void;
	onHide: () => void;
}) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<string[]>(OPEN_BY_DEFAULT);
	const needle = query.trim().toLowerCase();
	const searching = needle !== "";
	const visible = searching
		? sections
				.map((section) => ({
					...section,
					items: section.items.filter((item) => matches(item, needle)),
				}))
				.filter((section) => section.items.length > 0)
		: sections;

	return (
		<>
			<div className="flex shrink-0 items-center gap-1 border-line-faint border-b p-2">
				<Input
					aria-label="Search steps"
					className="min-w-0 flex-1"
					mode="search"
					onValueChange={setQuery}
					placeholder="Search steps"
					size="sm"
					value={query}
				/>
				<Button
					aria-label="Hide toolbox"
					onClick={onHide}
					size="icon-sm"
					variant="ghost"
				>
					<Icon icon={Close} />
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{visible.length === 0 ? (
					<p className="px-1 py-3 type-body-sm text-text-2">
						No steps match “{query.trim()}”.
					</p>
				) : (
					<CollapsibleGroup
						multiple
						onValueChange={(next) => setOpen(next as string[])}
						value={searching ? visible.map((section) => section.kind) : open}
						variant="plain"
					>
						{visible.map((section) => (
							<Collapsible key={section.kind} value={section.kind}>
								<CollapsibleTrigger summary={String(section.items.length)}>
									<span className="inline-flex items-center gap-2">
										<Icon icon={KIND_ICON[section.kind]} />
										{section.title}
									</span>
								</CollapsibleTrigger>
								<CollapsibleContent className="max-w-none pe-0 pb-2 group-data-[variant=plain]/collapsible-group:ps-2">
									<div className="flex flex-col">
										{section.items.map((item) => (
											<ToolboxRow
												disabled={readOnly}
												item={item}
												key={item.id}
												onAdd={onAdd}
											/>
										))}
									</div>
									{section.kind === "rule" && !searching ? (
										<Button
											className="ms-0.5 mt-1"
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
								</CollapsibleContent>
							</Collapsible>
						))}
					</CollapsibleGroup>
				)}
			</div>
		</>
	);
}

function toolboxItemIcon(item: ToolboxItem) {
	switch (item.kind) {
		case "trigger":
			return triggerIcon(item.eventKind);
		case "rule":
			return ruleIcon(item.ref);
		case "gate":
			return gateIcon(item.mode);
		case "action":
			return actionIcon(item.action);
		default:
			return KIND_ICON.rule;
	}
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
			title={item.description}
			{...listeners}
		>
			<ItemMedia>
				<Icon className="text-text-2" icon={toolboxItemIcon(item)} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span className="truncate">{item.name}</span>
				</ItemTitle>
			</ItemContent>
			<ItemActions className="static -me-3">
				<Button
					aria-label={`Add ${item.name}`}
					className="static after:absolute after:inset-0 after:content-['']"
					data-slot="item-link"
					disabled={disabled}
					onClick={() => onAdd(item)}
					size="icon-sm"
					variant="ghost"
				>
					<Icon
						className="opacity-0 transition-opacity duration-(--dur-state) group-hover/item:opacity-100 group-has-[[data-slot=item-link]:focus-visible]/item:opacity-100 pointer-coarse:opacity-100"
						icon={Add}
					/>
				</Button>
			</ItemActions>
		</Item>
	);
}

function StepProperties({
	node,
	customName,
	readOnly,
	onBack,
	onUpdate,
	onTestConnection,
}: {
	node: WorkflowNode;
	customName: string | null;
	readOnly: boolean;
	onBack: () => void;
	onUpdate: (next: WorkflowNode) => void;
	onTestConnection: EditorSidebarProps["onTestConnection"];
}) {
	const name = stepName(node, customName);
	const kind = KIND_LABEL[node.type];
	return (
		<>
			<div className="flex shrink-0 items-center gap-2 border-line-faint border-b py-2 ps-2 pe-3">
				<Button
					aria-label="Back to the toolbox"
					onClick={onBack}
					size="icon-sm"
					variant="ghost"
				>
					<Icon icon={ArrowLeft} />
				</Button>
				<Icon className="text-text-2" icon={stepIcon(node)} />
				<h2 className="min-w-0 flex-1 truncate type-label">{name}</h2>
				{kind === name ? null : (
					<span className="shrink-0 type-caption text-text-2">{kind}</span>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{hasEditableParams(node) ? (
					<PropertiesPanel
						node={node}
						onTestConnection={onTestConnection}
						onUpdate={onUpdate}
						readOnly={readOnly}
					/>
				) : (
					<p className="type-body-sm text-text-2">
						This step has no settings to change.
					</p>
				)}
			</div>
		</>
	);
}
