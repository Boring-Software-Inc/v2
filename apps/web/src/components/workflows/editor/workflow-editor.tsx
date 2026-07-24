import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type {
	ValidationIssue,
	WorkflowDefinition,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	customValidationEntries,
	RULE_CATALOG,
	validateWorkflowForEnable,
} from "@tripwire/contracts";
import {
	addEdge,
	Background,
	type Connection,
	Controls,
	type Edge,
	type EdgeChange,
	type NodeChange,
	ReactFlow,
	ReactFlowProvider,
	reconnectEdge,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "#/components/ui/toast";
import { EditorHeader } from "#/components/workflows/editor/editor-header";
import {
	buildNodeFromItem,
	EditorSidebar,
	type ToolboxItem,
} from "#/components/workflows/editor/editor-sidebar";
import {
	type TripwireFlowNode,
	TripwireNode,
} from "#/components/workflows/editor/node-card";
import {
	CustomRuleNamesContext,
	NodeIssuesContext,
} from "#/components/workflows/editor/node-issues";
import { KIND_STYLES } from "#/components/workflows/editor/node-kind-styles";
import { cn } from "#/lib/utils";
import {
	definitionToGraph,
	type EditorEdge,
	type EditorNode,
	graphToDefinition,
	handleWhen,
} from "#/lib/workflow-editor";
import "@xyflow/react/dist/style.css";

const NODE_TYPES = { tripwire: TripwireNode };
const DELETE_KEYS = ["Backspace", "Delete"];
const CANVAS_DROP_ID = "workflow-canvas";

/**
 * The droppable MUST be a child of <DndContext> — a useDroppable call in the
 * same component that renders the provider registers into dnd-kit's DEFAULT
 * context instead, and `event.over` stays undefined forever (the bug that
 * made drag-in silently no-op).
 */
function CanvasDropzone({ children }: { children: React.ReactNode }) {
	const { setNodeRef } = useDroppable({ id: CANVAS_DROP_ID });
	return (
		<div className="relative min-h-0 flex-1" ref={setNodeRef}>
			{children}
		</div>
	);
}

export interface WorkflowEditorProps {
	/** The repo's custom rules for the palette. */
	customRules: { ref: string; name: string; description: string }[];
	definition: WorkflowDefinition;
	name: string;
	enabled: boolean;
	readOnly: boolean;
	org: string;
	repo: string;
	saving: boolean;
	toggling: boolean;
	onSave: (definition: WorkflowDefinition) => Promise<{
		ok: boolean;
		error?: string;
		connectionIssues?: { nodeId: string; message: string }[];
	}>;
	/** Panel "test connection" — probes a delivery url through the guard. */
	onTestConnection: (
		url: string,
		kind: "webhook" | "discord",
	) => Promise<{ ok: boolean; status?: number; failure?: string }>;
	onRename: (name: string) => Promise<{ ok: boolean; error?: string }>;
	onSetEnabled: (
		enabled: boolean,
	) => Promise<
		{ ok: true; enabled: boolean } | { ok: false; issues: ValidationIssue[] }
	>;
}

export function WorkflowEditor(props: WorkflowEditorProps) {
	return (
		<ReactFlowProvider>
			<EditorBody {...props} />
		</ReactFlowProvider>
	);
}

function EditorBody({
	customRules,
	definition,
	name,
	enabled,
	readOnly,
	org,
	repo,
	saving,
	toggling,
	onSave,
	onRename,
	onSetEnabled,
	onTestConnection,
}: WorkflowEditorProps) {
	const initial = useMemo(() => definitionToGraph(definition), [definition]);
	// Connection-test failures from the last save, keyed by node — merged into
	// the validation issues so they surface with the same red-dot treatment.
	const [connectionIssues, setConnectionIssues] = useState<
		Map<string, string[]>
	>(new Map());
	const [nodes, setNodes, onNodesStateChange] = useNodesState(
		initial.nodes as TripwireFlowNode[],
	);
	const [edges, setEdges, onEdgesStateChange] = useEdgesState(
		initial.edges as Edge[],
	);
	const [dirty, setDirty] = useState(false);
	const [dragged, setDragged] = useState<ToolboxItem | null>(null);
	const { screenToFlowPosition } = useReactFlow();

	// meta rides the LOADED definition; a rename lands on refetch, and the next
	// save picks it up — the definition stays the single artifact.
	const meta = useMemo(
		() => ({
			id: definition.id,
			name: definition.name,
			version: definition.version,
		}),
		[definition],
	);

	// Enable-check against the RUNTIME catalog — built-ins plus this repo's
	// custom rules — so the editor's live preview matches the server. Without
	// the custom entries a custom rule reads as "unknown rule" and blocks enable
	// from the editor, even though the list page (server-validated) enables it.
	const enableCatalog = useMemo(
		() => [...RULE_CATALOG, ...customValidationEntries(customRules)],
		[customRules],
	);

	// ---- live validation (never save-blocking) ----------------------------
	const validation = useMemo(() => {
		if (nodes.length === 0) {
			return { structuralError: null as string | null, issues: [] };
		}
		const result = graphToDefinition(
			meta,
			nodes as unknown as EditorNode[],
			edges as unknown as EditorEdge[],
		);
		if (!result.ok) {
			return { structuralError: result.error, issues: [] };
		}
		const checked = validateWorkflowForEnable(result.definition, enableCatalog);
		return {
			structuralError: null,
			issues: checked.valid ? [] : checked.issues,
		};
	}, [nodes, edges, meta, enableCatalog]);

	const customRuleNames = useMemo(
		() => new Map(customRules.map((rule) => [rule.ref, rule.name])),
		[customRules],
	);
	const issuesByNode = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const issue of validation.issues) {
			if (issue.nodeId) {
				map.set(issue.nodeId, [
					...(map.get(issue.nodeId) ?? []),
					issue.message,
				]);
			}
		}
		// Layer the last save's connection failures on top — same surface.
		for (const [nodeId, messages] of connectionIssues) {
			map.set(nodeId, [...(map.get(nodeId) ?? []), ...messages]);
		}
		return map;
	}, [validation.issues, connectionIssues]);

	const blockers: ValidationIssue[] = validation.structuralError
		? [{ message: validation.structuralError }]
		: validation.issues;

	// ---- graph mutations ---------------------------------------------------
	const onNodesChange = useCallback(
		(changes: NodeChange<TripwireFlowNode>[]) => {
			onNodesStateChange(changes);
			if (
				changes.some(
					(change) => change.type !== "select" && change.type !== "dimensions",
				)
			) {
				setDirty(true);
			}
		},
		[onNodesStateChange],
	);

	const onEdgesChange = useCallback(
		(changes: EdgeChange<Edge>[]) => {
			onEdgesStateChange(changes);
			if (changes.some((change) => change.type !== "select")) {
				setDirty(true);
			}
		},
		[onEdgesStateChange],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			const when = handleWhen(connection.sourceHandle);
			setEdges((current) =>
				addEdge(
					{
						...connection,
						id: crypto.randomUUID(),
						...(when ? { label: when } : {}),
					},
					current,
				),
			);
			setDirty(true);
		},
		[setEdges],
	);

	const onReconnect = useCallback(
		(oldEdge: Edge, connection: Connection) => {
			const when = handleWhen(connection.sourceHandle);
			setEdges((current) =>
				reconnectEdge(oldEdge, connection, current).map((edge) =>
					edge.id === oldEdge.id ? { ...edge, label: when } : edge,
				),
			);
			setDirty(true);
		},
		[setEdges],
	);

	const insertNode = useCallback(
		(node: WorkflowNode, position: { x: number; y: number }) => {
			setNodes((current) => [
				...current.map((n) => ({ ...n, selected: false })),
				{
					id: node.id,
					position,
					data: { node },
					type: "tripwire" as const,
					selected: true,
				},
			]);
			setDirty(true);
		},
		[setNodes],
	);

	const updateNode = useCallback(
		(next: WorkflowNode) => {
			setNodes((current) =>
				current.map((n) =>
					n.id === next.id ? { ...n, data: { node: next } } : n,
				),
			);
			setDirty(true);
		},
		[setNodes],
	);

	const selectNode = useCallback(
		(nodeId: string) => {
			setNodes((current) =>
				current.map((n) => ({ ...n, selected: n.id === nodeId })),
			);
		},
		[setNodes],
	);

	const selectedFlowNodes = nodes.filter((n) => n.selected);
	const selectedNode =
		selectedFlowNodes.length === 1
			? (selectedFlowNodes[0]?.data.node ?? null)
			: null;

	// ---- dnd-kit drag-in ---------------------------------------------------
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);

	const onDragStart = (event: DragStartEvent) => {
		setDragged((event.active.data.current as ToolboxItem) ?? null);
	};

	const onDragEnd = (event: DragEndEvent) => {
		setDragged(null);
		if (readOnly || event.over?.id !== CANVAS_DROP_ID) {
			return;
		}
		const item = event.active.data.current as ToolboxItem | undefined;
		const activator = event.activatorEvent as Partial<PointerEvent>;
		if (
			!item ||
			typeof activator.clientX !== "number" ||
			typeof activator.clientY !== "number"
		) {
			return;
		}
		// pointer position = where the drag STARTED (activatorEvent) plus how
		// far it travelled (delta) — dnd-kit has no per-move pointer on end.
		const position = screenToFlowPosition({
			x: activator.clientX + event.delta.x,
			y: activator.clientY + event.delta.y,
		});
		insertNode(buildNodeFromItem(item), {
			// Center-ish for the wider, taller field-bearing cards.
			x: position.x - 110,
			y: position.y - 40,
		});
	};

	/** click-to-add fallback: below the current graph, never on top of it. */
	const addAtFreePosition = (item: ToolboxItem) => {
		if (readOnly) {
			return;
		}
		const y =
			nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.y)) + 150 : 80;
		insertNode(buildNodeFromItem(item), { x: 80, y });
	};

	// ---- save ---------------------------------------------------------------
	const handleSave = async () => {
		const result = graphToDefinition(
			meta,
			nodes as unknown as EditorNode[],
			edges as unknown as EditorEdge[],
		);
		if (!result.ok) {
			toast(result.error);
			return;
		}
		const saved = await onSave(result.definition);
		if (saved.ok) {
			setDirty(false);
			const failed = saved.connectionIssues ?? [];
			setConnectionIssues(
				new Map(failed.map((issue) => [issue.nodeId, [issue.message]])),
			);
			toast(
				failed.length > 0
					? "workflow saved. a webhook connection failed — see the node."
					: "workflow saved",
			);
		} else {
			toast(saved.error ?? "couldn't save");
		}
	};

	const handleSetEnabled = async (next: boolean) => {
		const result = await onSetEnabled(next);
		if (result.ok) {
			toast(result.enabled ? "workflow enabled" : "workflow disabled");
		} else {
			// server is authoritative — surface its issues verbatim.
			toast(result.issues.map((issue) => issue.message).join("; "));
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<EditorHeader
				blockers={blockers}
				customRules={customRules}
				definition={definition}
				dirty={dirty}
				enabled={enabled}
				name={name}
				onRename={onRename}
				onSave={handleSave}
				onSetEnabled={handleSetEnabled}
				org={org}
				readOnly={readOnly}
				repo={repo}
				saving={saving}
				toggling={toggling}
				zeroNodes={nodes.length === 0}
			/>
			<DndContext
				onDragEnd={onDragEnd}
				onDragStart={onDragStart}
				sensors={sensors}
			>
				<CanvasDropzone>
					<CustomRuleNamesContext.Provider value={customRuleNames}>
						<NodeIssuesContext.Provider value={issuesByNode}>
							<ReactFlow
								deleteKeyCode={readOnly ? null : DELETE_KEYS}
								edges={edges}
								edgesReconnectable={!readOnly}
								elementsSelectable
								fitView
								nodes={nodes}
								nodesConnectable={!readOnly}
								nodesDraggable={!readOnly}
								nodeTypes={NODE_TYPES}
								onConnect={readOnly ? undefined : onConnect}
								onEdgesChange={onEdgesChange}
								onNodesChange={onNodesChange}
								onReconnect={readOnly ? undefined : onReconnect}
								proOptions={{ hideAttribution: true }}
							>
								<Background gap={16} />
								<Controls position="bottom-right" showInteractive={false} />
							</ReactFlow>
						</NodeIssuesContext.Provider>
					</CustomRuleNamesContext.Provider>
					<EditorSidebar
						customRules={customRules}
						org={org}
						repo={repo}
						onAdd={addAtFreePosition}
						onTestConnection={onTestConnection}
						onUpdateNode={updateNode}
						readOnly={readOnly}
						selectedNode={selectedNode}
					/>
					<IssuesPanel
						issues={validation.issues}
						onSelect={selectNode}
						structuralError={validation.structuralError}
					/>
					{nodes.length === 0 ? (
						<div className="pointer-events-none absolute inset-0 grid place-items-center">
							<p className="text-muted-foreground text-xs">
								drag a block from the toolbox
							</p>
						</div>
					) : null}
				</CanvasDropzone>
				<DragOverlay dropAnimation={null}>
					{dragged ? (
						<div
							className={cn(
								"rounded-md border border-l-2 bg-card px-2 py-1.5 text-xs shadow-md",
								KIND_STYLES[dragged.kind].accent,
							)}
						>
							{dragged.name}
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</div>
	);
}

function IssuesPanel({
	structuralError,
	issues,
	onSelect,
}: {
	structuralError: string | null;
	issues: ValidationIssue[];
	onSelect: (nodeId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const count = issues.length + (structuralError ? 1 : 0);
	if (count === 0) {
		return null;
	}
	return (
		<div className="absolute bottom-4 left-3 z-10 flex flex-col items-start gap-2">
			{open ? (
				<div className="max-h-56 w-72 overflow-y-auto rounded-lg border bg-card/95 p-1.5 shadow-md backdrop-blur">
					{structuralError ? (
						<p className="px-2 py-1 text-red-500 text-xs">{structuralError}</p>
					) : null}
					{issues.map((issue) => (
						<button
							className="flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-surface-1"
							key={`${issue.nodeId ?? issue.edgeId ?? "graph"}-${issue.message}`}
							onClick={() => issue.nodeId && onSelect(issue.nodeId)}
							type="button"
						>
							<span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-red-500" />
							{issue.message}
						</button>
					))}
				</div>
			) : null}
			<button
				className="rounded-full border bg-card px-2.5 py-1 text-xs shadow-sm transition-colors hover:bg-surface-1"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<span className="mr-1.5 inline-block size-1.5 rounded-full bg-red-500 align-middle" />
				{count === 1 ? "1 issue" : `${count} issues`}
			</button>
		</div>
	);
}
