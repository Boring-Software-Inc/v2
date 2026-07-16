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
import { validateWorkflowForEnable } from "@tripwire/contracts";
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
import { toast } from "sonner";
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
import { NodeIssuesContext } from "#/components/workflows/editor/node-issues";
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

export interface WorkflowEditorProps {
	definition: WorkflowDefinition;
	name: string;
	enabled: boolean;
	readOnly: boolean;
	org: string;
	repo: string;
	saving: boolean;
	toggling: boolean;
	onSave: (
		definition: WorkflowDefinition,
	) => Promise<{ ok: boolean; error?: string }>;
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
}: WorkflowEditorProps) {
	const initial = useMemo(() => definitionToGraph(definition), [definition]);
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
		const checked = validateWorkflowForEnable(result.definition);
		return {
			structuralError: null,
			issues: checked.valid ? [] : checked.issues,
		};
	}, [nodes, edges, meta]);

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
		return map;
	}, [validation.issues]);

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
	const { setNodeRef: setDropRef } = useDroppable({ id: CANVAS_DROP_ID });

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
			x: position.x - 80,
			y: position.y - 24,
		});
	};

	/** click-to-add fallback: below the current graph, never on top of it. */
	const addAtFreePosition = (item: ToolboxItem) => {
		if (readOnly) {
			return;
		}
		const y =
			nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.y)) + 110 : 80;
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
			toast("workflow saved");
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
				<div className="relative min-h-0 flex-1" ref={setDropRef}>
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
					<EditorSidebar
						onAdd={addAtFreePosition}
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
				</div>
				<DragOverlay dropAnimation={null}>
					{dragged ? (
						<div className="rounded-md border bg-card px-2 py-1.5 text-xs shadow-md">
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
