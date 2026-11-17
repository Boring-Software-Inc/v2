import { useDraggable } from "@dnd-kit/core";
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
	outputLook,
	RULE_CATALOG,
	TRIGGER_CATALOG,
	WORKFLOW_PORT_LABELS,
} from "@tripwire/contracts";
import { Button, IconButton } from "@tripwire/ui/button";
import { Drawer } from "@tripwire/ui/drawer";
import { Add, Close, Icon } from "@tripwire/ui/icon";
import { Tabs } from "@tripwire/ui/tabs";
import { Tooltip } from "@tripwire/ui/tooltip";
import { SupportingText, Label as TextLabel } from "@tripwire/ui/typography";
import { generateId } from "@tripwire/utils/id";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	GroupedPicker,
	PickerRow,
	PickerRowAction,
} from "#/components/common/grouped-picker";
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
import { cn } from "#/lib/utils";

/**
 * The inset left rail. With nothing selected it is the toolbox
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
		items: GATE_CATALOG.filter((entry) => entry.toolbox).map((entry) => ({
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
	const id = generateId();
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

export function mobileToolboxIsOpen({
	desktop,
	pending,
	panel,
}: {
	desktop: boolean;
	pending: boolean;
	panel: "toolbox" | "properties" | null;
}) {
	return !desktop && (pending || panel === "toolbox");
}

export function sidebarLayoutKey(
	visibility: "auto" | "open" | "closed",
	_propertiesNodeId: string | null,
) {
	return visibility === "closed" ? "canvas" : "rail";
}

export function focusWorkflowNode(
	nodes: Iterable<{ dataset: { id?: string }; focus: () => void }>,
	nodeId: string,
) {
	const node = Array.from(nodes).find(
		(candidate) => candidate.dataset.id === nodeId,
	);
	node?.focus();
	return node !== undefined;
}

export interface EditorSidebarProps {
	children: ReactNode;
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
	onDuplicateSelected: () => void;
	onRemoveSelected: () => void;
	onLayoutSettled: () => void;
	onUpdateNode: (next: WorkflowNode) => void;
	renderHeader: () => ReactNode;
	renderToolbar: (
		onOpenToolbox: (trigger: HTMLButtonElement) => void,
	) => ReactNode;
	onTestConnection: (
		url: string,
		kind: "webhook" | "discord",
	) => Promise<{ ok: boolean; status?: number; failure?: string }>;
}

export function EditorSidebar({
	children,
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
	onDuplicateSelected,
	onRemoveSelected,
	onLayoutSettled,
	onUpdateNode,
	onTestConnection,
	renderHeader,
	renderToolbar,
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
	const [mobilePanel, setMobilePanel] = useState<
		"toolbox" | "properties" | null
	>(null);
	const [desktop, setDesktop] = useState(true);
	const reducedMotion = useReducedMotion();
	const mobileTrigger = useRef<HTMLElement | null>(null);
	const rail = useRef<HTMLElement | null>(null);
	const railHadFocus = useRef(false);
	const previousSelectedNodeId = useRef<string | null>(
		selectedNode?.id ?? null,
	);
	const addAndReveal = (item: ToolboxItem) => {
		onAdd(item);
		if (!window.matchMedia("(min-width: 768px)").matches) {
			setMobilePanel(null);
			requestAnimationFrame(() => mobileTrigger.current?.focus());
		}
	};
	const customName =
		selectedNode?.type === "rule"
			? (customRules.find((rule) => rule.ref === selectedNode.ref)?.name ??
				null)
			: null;
	const visibility = connect?.pending ? "open" : shown;
	const [toolboxFor, setToolboxFor] = useState<string | null>(null);
	const selectable = connect ? null : selectedNode;
	const propertiesNode =
		selectable && toolboxFor !== selectable.id ? selectable : null;
	const desktopPanel = propertiesNode ? "properties" : "toolbox";
	const layoutState = sidebarLayoutKey(visibility, propertiesNode?.id ?? null);
	const pendingMobileToolbox = connect?.pending === true;
	const mobileToolboxOpen = mobileToolboxIsOpen({
		desktop,
		pending: pendingMobileToolbox,
		panel: mobilePanel,
	});
	const openToolbox = (trigger: HTMLButtonElement) => {
		mobileTrigger.current = trigger;
		setToolboxFor(selectable?.id ?? null);
		if (window.matchMedia("(min-width: 768px)").matches) {
			setShown("open");
		} else {
			setMobilePanel("toolbox");
		}
	};
	const closeMobile = () => {
		setMobilePanel(null);
		requestAnimationFrame(() => mobileTrigger.current?.focus());
	};
	const closeToolbox = () => {
		setShown("closed");
		requestAnimationFrame(() =>
			document
				.querySelector<HTMLButtonElement>(
					'[data-layout-role="workflow-toolbox-summon"] button',
				)
				?.focus(),
		);
	};
	const closeProperties = () => {
		setShown("closed");
		const nodeId = propertiesNode?.id;
		if (nodeId) {
			requestAnimationFrame(() => {
				focusWorkflowNode(
					document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
					nodeId,
				);
			});
		}
	};
	const changeDesktopPanel = (panel: string) => {
		if (panel === "toolbox") {
			setToolboxFor(selectable?.id ?? null);
			return;
		}
		if (panel === "properties" && selectable) setToolboxFor(null);
	};

	useEffect(() => {
		const query = window.matchMedia("(min-width: 768px)");
		const update = () => {
			setDesktop(query.matches);
			if (query.matches) setMobilePanel(null);
		};
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		if (!desktop) return;
		setShown("open");
		if (!selectedNode) setToolboxFor(null);
	}, [desktop, selectedNode]);

	useEffect(() => {
		const previousId = previousSelectedNodeId.current;
		previousSelectedNodeId.current = selectedNode?.id ?? null;
		if (desktop && previousId && !selectedNode && railHadFocus.current) {
			requestAnimationFrame(() => {
				document
					.querySelector<HTMLButtonElement>(
						'[data-layout-role="workflow-sidebar-header"] button[aria-label^="Hide"]',
					)
					?.focus();
				railHadFocus.current = false;
			});
		}
	}, [desktop, selectedNode]);

	useEffect(() => {
		if (!desktop) return;
		const settle = window.setTimeout(
			() => {
				if (layoutState) onLayoutSettled();
			},
			reducedMotion ? 0 : 180,
		);
		return () => window.clearTimeout(settle);
	}, [desktop, layoutState, onLayoutSettled, reducedMotion]);

	useEffect(() => {
		if (propertiesNode && !desktop) {
			mobileTrigger.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setMobilePanel("properties");
		}
	}, [desktop, propertiesNode]);

	const toolbox = (
		<Toolbox
			connect={connect}
			onAdd={addAndReveal}
			onCancelConnect={onCancelConnect}
			org={org}
			readOnly={readOnly}
			repo={repo}
			sections={sections}
		/>
	);
	const properties = propertiesNode ? (
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
			org={org}
			readOnly={readOnly}
		/>
	) : null;

	return (
		<div data-layout-role="workflow-shell">
			{renderHeader()}
			<div
				data-layout-role="workflow-shell-body"
				data-rail-open={visibility !== "closed" ? "" : undefined}
			>
				<aside
					aria-label={desktopPanel === "properties" ? "Properties" : "Toolbox"}
					data-panel={desktopPanel}
					data-toolbox={desktopPanel === "toolbox" ? "" : undefined}
					data-layout-role="workflow-sidebar-rail"
					data-open={visibility !== "closed" ? "" : undefined}
					id="workflow-sidebar-rail"
					onBlurCapture={(event) => {
						if (
							event.relatedTarget instanceof Node &&
							!event.currentTarget.contains(event.relatedTarget)
						) {
							railHadFocus.current = false;
						}
					}}
					onFocusCapture={() => {
						railHadFocus.current = true;
					}}
					ref={rail}
				>
					{visibility !== "closed" ? (
						<>
							<div data-layout-role="workflow-sidebar-header">
								<Tabs
									ariaLabel="Workflow sidebar"
									items={[
										{ label: "Toolbox", value: "toolbox" },
										{
											disabled: !selectable,
											label: "Properties",
											value: "properties",
										},
									]}
									onValueChange={(panel) => {
										if (panel) changeDesktopPanel(panel);
									}}
									panelMode="external"
									size="small"
									value={desktopPanel}
								/>
								{connect?.pending ? null : (
									<IconButton
										icon={<Icon icon={Close} />}
										label={`Hide ${desktopPanel}`}
										onAction={propertiesNode ? closeProperties : closeToolbox}
										size="small"
										variant="ghost"
									/>
								)}
							</div>
							<div data-layout-role="workflow-sidebar-body">
								{desktop ? (propertiesNode ? properties : toolbox) : null}
							</div>
						</>
					) : null}
				</aside>

				<div data-layout-role="workflow-canvas-stage">
					{renderToolbar(openToolbox)}
					{visibility === "closed" ? (
						<span data-layout-role="workflow-toolbox-summon">
							<Button
								onAction={() => {
									const trigger = document.activeElement;
									if (trigger instanceof HTMLButtonElement)
										openToolbox(trigger);
								}}
								size="small"
							>
								{readOnly ? null : <Icon icon={Add} />}
								Toolbox
							</Button>
						</span>
					) : null}
					{children}
				</div>
			</div>

			<Drawer
				bodyInset="content"
				dismissible={!pendingMobileToolbox}
				onOpenChange={(open) => {
					if (!open && !pendingMobileToolbox) closeMobile();
				}}
				open={mobileToolboxOpen}
				showCloseAction={!pendingMobileToolbox}
				showFooter={!pendingMobileToolbox}
				side="bottom"
				title="Toolbox"
			>
				<div data-toolbox="">{desktop ? null : toolbox}</div>
			</Drawer>

			<Drawer
				bodyInset="content"
				onOpenChange={(open) => {
					if (!open) {
						closeMobile();
						onClearSelection();
					}
				}}
				open={
					!desktop && mobilePanel === "properties" && propertiesNode !== null
				}
				primaryAction={
					readOnly
						? undefined
						: {
								confirmation: {
									confirmLabel: "Remove",
									description: "This step will be removed from the workflow.",
									title: "Remove this step?",
								},
								label: "Remove",
								onAction: onRemoveSelected,
								variant: "destructive",
							}
				}
				secondaryAction={
					readOnly
						? undefined
						: { label: "Duplicate", onAction: onDuplicateSelected }
				}
				side="bottom"
				title={
					propertiesNode
						? `${selectedNameFor(propertiesNode, customName)} properties`
						: "Properties"
				}
			>
				{desktop ? null : properties}
			</Drawer>
		</div>
	);
}

function selectedNameFor(node: WorkflowNode, customName: string | null) {
	return stepName(node, customName);
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
	return (
		<>
			{connect ? (
				<div data-layout-role="workflow-toolbox-connect">
					<PortGlyph look={{ ...outputLook(connect.port), io: "out" }} />
					<TextLabel data-layout-role="workflow-toolbox-connect-label">
						{connect.insert
							? "Insert a rule"
							: `Connect from ${WORKFLOW_PORT_LABELS[connect.port]}`}
					</TextLabel>
					{connect.pending ? (
						<IconButton
							icon={<Icon icon={Close} />}
							label="Cancel connection"
							onAction={onCancelConnect}
							size="small"
							variant="ghost"
						/>
					) : null}
				</div>
			) : null}
			<GroupedPicker
				defaultOpen={OPEN_BY_DEFAULT}
				forceOpen={connect !== null}
				groups={sections.map((section) => ({
					key: section.kind,
					title: section.title,
					icon: KIND_ICON[section.kind],
					items: section.items,
				}))}
				matches={matches}
				noun="steps"
				renderFooter={(group, allOpen) =>
					group.key === "rule" && !allOpen ? (
						<span data-layout-role="workflow-toolbox-create-rule">
							<Button
								href={`/${org}/${repo}/rules`}
								size="small"
								variant="ghost"
							>
								<Icon icon={Add} />
								Create rule
							</Button>
						</span>
					) : null
				}
				renderItem={(item) => (
					<ToolboxRow
						disabled={readOnly}
						item={item}
						key={item.id}
						onAdd={onAdd}
						picking={connect?.pending ?? false}
						refusal={connectRefusal(connect, item.kind)}
					/>
				)}
			/>
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
		<PickerRowAction
			ariaLabel={`Add ${item.name}`}
			disabled={disabled || refused}
			glyph={Add}
			reveal={refused ? "touch" : "hover"}
		/>
	);
	return (
		<div
			className={cn(
				!(disabled || refused || picking) && "cursor-grab",
				isDragging && "opacity-40",
			)}
			ref={setNodeRef}
			{...listeners}
		>
			<PickerRow
				action={
					<>
						{refused ? (
							<Tooltip placement="right" trigger={addButton}>
								{refusal}
							</Tooltip>
						) : (
							addButton
						)}
						{refused ? (
							<span className="sr-only" id={reasonId}>
								{refusal}
							</span>
						) : null}
					</>
				}
				disabled={disabled || refused}
				icon={toolboxItemIcon(item)}
				muted={refused}
				name={item.name}
				onClick={disabled || refused ? undefined : () => onAdd(item)}
				title={refused ? undefined : item.description}
			/>
		</div>
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
	org,
}: {
	node: WorkflowNode;
	customName: string | null;
	focusKey: string | null;
	readOnly: boolean;
	onFocused: () => void;
	onUpdate: (next: WorkflowNode) => void;
	onTestConnection: EditorSidebarProps["onTestConnection"];
	org: string;
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
		<div data-layout-role="workflow-step-properties" ref={bodyRef}>
			<div data-layout-role="workflow-step-properties-heading">
				<Icon icon={stepIcon(node)} />
				<h2>{name}</h2>
			</div>
			<div data-layout-role="workflow-step-properties-body">
				{hasEditableParams(node) ? (
					<PropertiesPanel
						node={node}
						onTestConnection={onTestConnection}
						onUpdate={onUpdate}
						org={org}
						readOnly={readOnly}
					/>
				) : (
					<SupportingText>This step has no settings to change.</SupportingText>
				)}
			</div>
		</div>
	);
}
