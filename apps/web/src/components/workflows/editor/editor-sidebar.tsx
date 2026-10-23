import { useDraggable } from "@dnd-kit/core";
import { Link } from "@tanstack/react-router";
import type {
	EventKind,
	GateMode,
	JsonValue,
	WorkflowActionKind,
	WorkflowNode,
	WorkflowPort,
} from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	acceptReason,
	GATE_CATALOG,
	NEW_SCHEDULE_DRAFT,
	RULE_CATALOG,
	TRIGGER_CATALOG,
	WORKFLOW_PORT_LABELS,
} from "@tripwire/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Add, Close, Icon } from "#/components/glaze/icon";
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
import { Tabs, TabsList, TabsTrigger } from "#/components/glaze/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/glaze/ui/tooltip";
import { outputLook } from "#/components/workflows/editor/connection-plan";
import {
	hasEditableParams,
	PropertiesPanel,
} from "#/components/workflows/editor/properties-panel";
import {
	actionIcon,
	gateIcon,
	KIND_ICON,
	ruleIcon,
	stepIcon,
	stepName,
	triggerIcon,
} from "#/components/workflows/editor/step-meta";
import { PortGlyph } from "#/components/workflows/editor/typed-connections";
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
			return item.eventKind === "schedule.matched"
				? {
						id,
						type: "trigger",
						kinds: [item.eventKind],
						schedule: structuredClone(NEW_SCHEDULE_DRAFT),
					}
				: { id, type: "trigger", kinds: [item.eventKind] };
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

export interface ToolboxConnect {
	port: WorkflowPort;
	pending: boolean;
	insert?: boolean;
}

function connectRefusal(
	connect: ToolboxConnect | null,
	kind: ToolboxItem["kind"],
): string | null {
	if (!connect) {
		return null;
	}
	if (connect.insert && kind !== "rule") {
		return "Only a rule fits here";
	}
	return acceptReason(kind, connect.port);
}

export interface EditorSidebarProps {
	connect: ToolboxConnect | null;
	onCancelConnect: () => void;
	/** The repo's custom rules; they join the rules section like built-ins. */
	customRules: CustomToolboxRule[];
	/** Route target for authoring a new rule (the rules page builder). */
	org: string;
	repo: string;
	readOnly: boolean;
	selectedNode: WorkflowNode | null;
	fieldFocus: { nodeId: string; key: string } | null;
	onFieldFocused: () => void;
	onAdd: (item: ToolboxItem) => void;
	onClearSelection: () => void;
	onUpdateNode: (next: WorkflowNode) => void;
	onTestConnection: (
		url: string,
	) => Promise<{ ok: boolean; status?: number; failure?: string }>;
}

export function EditorSidebar({
	connect,
	onCancelConnect,
	customRules,
	org,
	repo,
	readOnly,
	selectedNode,
	fieldFocus,
	onFieldFocused,
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
	const visibility = selectedNode || connect?.pending ? "open" : shown;
	const [toolboxFor, setToolboxFor] = useState<string | null>(null);
	const selectable = connect ? null : selectedNode;
	const propertiesNode =
		selectable && toolboxFor !== selectable.id ? selectable : null;
	const hide = () => {
		onClearSelection();
		setShown("closed");
	};

	return (
		<>
			<Button
				className={cn(
					"absolute start-3 top-3 z-(--z-raised)",
					visibility === "auto" && "md:hidden",
					visibility === "open" && "hidden",
				)}
				onClick={() => setShown("open")}
				size="sm"
				variant="secondary"
			>
				{readOnly ? null : <Icon icon={Add} />}
				{readOnly ? "Show toolbox" : "Add steps"}
			</Button>
			<div
				data-toolbox=""
				className={cn(
					"shell absolute start-3 top-3 bottom-3 z-(--z-raised) w-75 flex-col",
					visibility === "auto" && "hidden md:flex",
					visibility === "open" && "flex",
					visibility === "closed" && "hidden",
				)}
			>
				<div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="flex shrink-0 items-center justify-between gap-2 border-line-faint border-b px-2 py-1.5">
						<Tabs
							onValueChange={(value) =>
								setToolboxFor(
									value === "toolbox" ? (selectable?.id ?? null) : null,
								)
							}
							value={propertiesNode ? "properties" : "toolbox"}
						>
							<TabsList aria-label="Sidebar" size="sm">
								<TabsTrigger value="toolbox">Toolbox</TabsTrigger>
								<TabsTrigger disabled={!selectable} value="properties">
									Properties
								</TabsTrigger>
							</TabsList>
						</Tabs>
						{connect?.pending ? null : (
							<Button
								aria-label="Hide sidebar"
								onClick={hide}
								size="icon-sm"
								variant="ghost"
							>
								<Icon icon={Close} />
							</Button>
						)}
					</div>
					{propertiesNode ? (
						<StepProperties
							customName={customName}
							focusKey={
								fieldFocus?.nodeId === propertiesNode.id ? fieldFocus.key : null
							}
							key={propertiesNode.id}
							node={propertiesNode}
							onFocused={onFieldFocused}
							onTestConnection={onTestConnection}
							onUpdate={onUpdateNode}
							readOnly={readOnly}
						/>
					) : (
						<Toolbox
							connect={connect}
							onAdd={addAndReveal}
							onCancelConnect={onCancelConnect}
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
	connect,
	readOnly,
	org,
	repo,
	onAdd,
	onCancelConnect,
}: {
	sections: ToolboxSection[];
	connect: ToolboxConnect | null;
	onCancelConnect: () => void;
	readOnly: boolean;
	org: string;
	repo: string;
	onAdd: (item: ToolboxItem) => void;
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

	const allOpen = searching || connect !== null;
	return (
		<>
			{connect ? (
				<div className="flex shrink-0 items-center gap-2 border-line-faint border-b py-1 ps-3 pe-2">
					<PortGlyph look={{ ...outputLook(connect.port), io: "out" }} />
					<span className="min-w-0 flex-1 truncate type-label">
						{connect.insert
							? "Insert a rule"
							: `Connect from ${WORKFLOW_PORT_LABELS[connect.port]}`}
					</span>
					{connect.pending ? (
						<Button
							aria-label="Cancel connection"
							onClick={onCancelConnect}
							size="icon-sm"
							variant="ghost"
						>
							<Icon icon={Close} />
						</Button>
					) : null}
				</div>
			) : null}
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
						value={allOpen ? visible.map((section) => section.kind) : open}
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
												refusal={connectRefusal(connect, item.kind)}
												picking={connect?.pending ?? false}
												key={item.id}
												onAdd={onAdd}
											/>
										))}
									</div>
									{section.kind === "rule" && !allOpen ? (
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
	refusal,
	picking,
	onAdd,
}: {
	item: ToolboxItem;
	disabled: boolean;
	refusal: string | null;
	picking: boolean;
	onAdd: (item: ToolboxItem) => void;
}) {
	const reasonId = useId();
	const refused = refusal !== null;
	const { listeners, setNodeRef, isDragging } = useDraggable({
		id: item.id,
		data: item,
		disabled: disabled || refused || picking,
	});
	const addButton = (
		<Button
			aria-describedby={refused ? reasonId : undefined}
			aria-disabled={refused || undefined}
			aria-label={`Add ${item.name}`}
			className="static after:absolute after:inset-0 after:content-['']"
			data-slot="item-link"
			disabled={disabled}
			size="icon-sm"
			variant="ghost"
		>
			<Icon
				className={cn(
					"opacity-0 transition-opacity duration-(--dur-state) pointer-coarse:opacity-100",
					!refused &&
						"group-hover/item:opacity-100 group-has-[[data-slot=item-link]:focus-visible]/item:opacity-100",
				)}
				icon={Add}
			/>
		</Button>
	);
	return (
		<Item
			className={cn(
				!(disabled || refused || picking) && "cursor-grab",
				isDragging && "opacity-40",
			)}
			disabled={disabled || refused}
			onClick={disabled || refused ? undefined : () => onAdd(item)}
			ref={setNodeRef}
			size="sm"
			title={refused ? undefined : item.description}
			{...listeners}
		>
			<ItemMedia>
				<Icon
					className={refused ? "text-text-disabled" : "text-text-2"}
					icon={toolboxItemIcon(item)}
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span className="truncate">{item.name}</span>
				</ItemTitle>
			</ItemContent>
			<ItemActions className="static -me-3">
				{refused ? (
					<Tooltip>
						<TooltipTrigger render={addButton} />
						<TooltipContent side="right">{refusal}</TooltipContent>
					</Tooltip>
				) : (
					addButton
				)}
				{refused ? (
					<span className="sr-only" id={reasonId}>
						{refusal}
					</span>
				) : null}
			</ItemActions>
		</Item>
	);
}

const FOCUSABLE_INPUT = "input:not([type=hidden]), textarea, select";
const FOCUSABLE_CONTROL = "button:not(:disabled), [role=checkbox]";

function StepProperties({
	node,
	customName,
	focusKey,
	readOnly,
	onFocused,
	onUpdate,
	onTestConnection,
}: {
	node: WorkflowNode;
	customName: string | null;
	focusKey: string | null;
	readOnly: boolean;
	onFocused: () => void;
	onUpdate: (next: WorkflowNode) => void;
	onTestConnection: EditorSidebarProps["onTestConnection"];
}) {
	const name = stepName(node, customName);
	const bodyRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const body = bodyRef.current;
		if (!(focusKey && body)) {
			return;
		}
		const scope =
			body.querySelector(`[data-field="${CSS.escape(focusKey)}"]`) ?? body;
		const control =
			scope.querySelector<HTMLElement>(FOCUSABLE_INPUT) ??
			scope.querySelector<HTMLElement>(FOCUSABLE_CONTROL);
		control?.focus();
		onFocused();
	}, [focusKey, onFocused]);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto" ref={bodyRef}>
			<div className="flex shrink-0 items-center gap-2 px-4 pt-3.5">
				<Icon className="text-text-1" icon={stepIcon(node)} />
				<h2 className="min-w-0 flex-1 type-label-lg [overflow-wrap:anywhere]">
					{name}
				</h2>
			</div>
			<div className="flex flex-col gap-3 px-4 pt-2.5 pb-4">
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
		</div>
	);
}
