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
import { useBlocker } from "@tanstack/react-router";
import type {
	EdgeWhen,
	LintFix,
	LintIntent,
	LintResult,
	ValidationIssue,
	WorkflowDefinition,
	WorkflowNode,
	WorkflowPort,
} from "@tripwire/contracts";
import {
	acceptReason,
	applyLintEdit,
	connectionIssue,
	customValidationEntries,
	edgePort,
	insertStep,
	lintWorkflow,
	openPosition,
	RULE_CATALOG,
	stepDisplayName,
	WORKFLOW_PORT_TONE,
} from "@tripwire/contracts";
import {
	addEdge,
	type Connection,
	type ConnectionState,
	Controls,
	type Edge,
	type EdgeChange,
	type FinalConnectionState,
	type InternalNode,
	type IsValidConnection,
	type NodeChange,
	ReactFlow,
	ReactFlowProvider,
	reconnectEdge,
	useConnection,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Dialog,
	DialogAction,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import { toast } from "#/components/glaze/ui/toast";
import {
	type DragOrigin,
	handlePort,
	planDrag,
	portHandleId,
} from "#/components/workflows/editor/connection-plan";
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
	EditFieldContext,
	groupProblems,
	type Problem,
	type ProblemsApi,
	ProblemsContext,
	problemCount,
} from "#/components/workflows/editor/node-issues";
import { ProblemsButton } from "#/components/workflows/editor/problems-list";
import {
	DragPlanContext,
	DropHint,
	PendingConnection,
	TypedConnectionLine,
	TypedEdge,
	type TypedFlowEdge,
} from "#/components/workflows/editor/typed-connections";
import {
	definitionToGraph,
	edgeWhenFields,
	graphToCandidate,
	graphToDefinition,
	handleWhen,
} from "#/lib/workflow-editor";
import "@xyflow/react/dist/style.css";

const NODE_TYPES = { tripwire: TripwireNode };
const EDGE_TYPES = { typed: TypedEdge };
const INPUT_HANDLE_OFFSET = { x: 0, y: 17 };
const NEXT_STEP_GAP = 96;
const CARD_WIDTH = 224;

type FlowEdge = Edge<{ when?: EdgeWhen; port?: WorkflowPort }>;

export interface PendingConnect {
	nodeId: string;
	handleId: string | null;
	port: WorkflowPort;
	at: { x: number; y: number };
	insert?: { edgeId: string };
}

function handlePoint(position: { x: number; y: number }) {
	return {
		x: position.x + INPUT_HANDLE_OFFSET.x,
		y: position.y + INPUT_HANDLE_OFFSET.y,
	};
}

function lintProblem(result: LintResult): Problem {
	return {
		key: `${result.rule}:${result.nodeId ?? ""}:${result.edgeId ?? ""}:${result.message}`,
		rule: result.rule,
		severity: result.severity,
		message: result.message,
		nodeId: result.nodeId,
		edgeId: result.edgeId,
		fixes: result.fixes,
	};
}

function serverProblem(issue: ValidationIssue): Problem {
	return {
		key: `server:${issue.rule ?? ""}:${issue.nodeId ?? ""}:${issue.edgeId ?? ""}:${issue.message}`,
		rule: issue.rule ?? null,
		severity: issue.severity ?? "error",
		message: issue.message,
		nodeId: issue.nodeId,
		edgeId: issue.edgeId,
		fixes: issue.fixes ?? [],
	};
}

function selectOrigin(
	connection: ConnectionState<InternalNode<TripwireFlowNode>>,
): DragOrigin | null {
	if (!connection.inProgress) {
		return null;
	}
	return {
		nodeId: connection.fromNode.id,
		handleId: connection.fromHandle.id ?? null,
		handleType: connection.fromHandle.type,
	};
}

function eventPoint(event: MouseEvent | TouchEvent) {
	const point = "changedTouches" in event ? event.changedTouches[0] : event;
	return { x: point?.clientX ?? 0, y: point?.clientY ?? 0 };
}
const DELETE_KEYS = ["Backspace", "Delete"];
const CANVAS_DROP_ID = "workflow-canvas";
function fitViewOptions() {
	const wide = globalThis.matchMedia?.("(min-width: 768px)").matches ?? false;
	return {
		padding: {
			left: wide ? "288px" : "48px",
			right: "48px",
			top: wide ? "48px" : "64px",
			bottom: "48px",
		},
	} as const;
}

const CANVAS_TOKENS = {
	"--xy-background-color": "var(--page)",
	"--xy-edge-stroke": "var(--ink-45)",
	"--xy-edge-stroke-selected": "var(--ink)",
	"--xy-connectionline-stroke": "var(--ink-45)",
	"--xy-edge-label-background-color": "var(--paper)",
	"--xy-edge-label-color": "var(--text-2)",
	"--xy-handle-background-color": "var(--ink-32)",
	"--xy-handle-border-color": "var(--paper)",
	"--xy-node-color": "var(--text-1)",
	"--xy-selection-background-color": "var(--ink-06)",
	"--xy-selection-border": "var(--line-width) dashed var(--line-strong)",
	"--xy-controls-box-shadow": "var(--shadow-none)",
	"--xy-controls-button-background-color": "var(--paper)",
	"--xy-controls-button-background-color-hover": "var(--hover)",
	"--xy-controls-button-color": "var(--text-1)",
	"--xy-controls-button-color-hover": "var(--text-1)",
	"--xy-controls-button-border-color": "var(--line-faint)",
} as React.CSSProperties;

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
	const [edges, setEdges, onEdgesStateChange] = useEdgesState<FlowEdge>(
		initial.edges,
	);
	const [dirty, setDirty] = useState(false);
	const [dragged, setDragged] = useState<ToolboxItem | null>(null);
	const { fitView, getIntersectingNodes, getZoom, screenToFlowPosition } =
		useReactFlow<TripwireFlowNode, FlowEdge>();
	const [problemsOpen, setProblemsOpen] = useState(false);
	const [serverIssues, setServerIssues] = useState<{
		against: readonly LintResult[];
		issues: ValidationIssue[];
	} | null>(null);
	const [pending, setPending] = useState<PendingConnect | null>(null);
	const reconnecting = useRef(false);
	const leave = useBlocker({
		shouldBlockFn: () => dirty && !readOnly,
		enableBeforeUnload: () => dirty && !readOnly,
		withResolver: true,
	});

	const onBeforeDelete = async ({
		nodes: deletedNodes,
		edges: deletedEdges,
	}: {
		nodes: TripwireFlowNode[];
		edges: FlowEdge[];
	}) => {
		const before = { nodes, edges };
		const stepCount = deletedNodes.length;
		const title =
			stepCount > 0
				? stepCount === 1
					? "Step deleted"
					: `${stepCount} steps deleted`
				: deletedEdges.length === 1
					? "Connection deleted"
					: `${deletedEdges.length} connections deleted`;
		toast(title, {
			action: {
				label: "Undo",
				onClick: () => {
					setNodes(before.nodes);
					setEdges(before.edges);
				},
			},
		});
		return true;
	};

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

	const stepName = useCallback(
		(node: WorkflowNode) => stepDisplayName(node, enableCatalog),
		[enableCatalog],
	);

	const lintResults = useMemo(
		() =>
			nodes.length === 0
				? []
				: lintWorkflow(graphToCandidate(meta, nodes, edges), {
						catalog: enableCatalog,
					}),
		[nodes, edges, meta, enableCatalog],
	);

	const customRuleNames = useMemo(
		() => new Map(customRules.map((rule) => [rule.ref, rule.name])),
		[customRules],
	);

	const problems = useMemo(() => {
		const local = lintResults.map(lintProblem);
		const delivery = [...connectionIssues].flatMap(([nodeId, messages]) =>
			messages.map(
				(message): Problem => ({
					key: `delivery:${nodeId}:${message}`,
					rule: "delivery",
					severity: "warning",
					message,
					nodeId,
					fixes: [
						{
							label: "Edit URL",
							intent: { type: "focus-field", nodeId, field: "url" },
						},
					],
				}),
			),
		);
		const known = new Set(local.map((problem) => problem.message));
		const server =
			serverIssues?.against === lintResults
				? serverIssues.issues
						.filter((issue) => !known.has(issue.message))
						.map(serverProblem)
				: [];
		return [...local, ...server, ...delivery].sort(
			(a, b) =>
				Number(a.severity === "warning") - Number(b.severity === "warning"),
		);
	}, [lintResults, connectionIssues, serverIssues]);

	const blockers = problems.filter((problem) => problem.severity === "error");

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
		(changes: EdgeChange<FlowEdge>[]) => {
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
						...edgeWhenFields(when),
					},
					current,
				),
			);
			setDirty(true);
		},
		[setEdges],
	);

	const onReconnect = useCallback(
		(oldEdge: FlowEdge, connection: Connection) => {
			const when = handleWhen(connection.sourceHandle);
			setEdges((current) =>
				reconnectEdge(oldEdge, connection, current).map((edge) =>
					edge.id === oldEdge.id
						? { ...edge, label: undefined, ...edgeWhenFields(when) }
						: edge,
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

	const clearSelection = useCallback(() => {
		setNodes((current) => current.map((n) => ({ ...n, selected: false })));
	}, [setNodes]);

	const [fieldFocus, setFieldFocus] = useState<{
		nodeId: string;
		key: string;
	} | null>(null);

	const editField = useCallback(
		(nodeId: string, key: string) => {
			selectNode(nodeId);
			setFieldFocus({ nodeId, key });
		},
		[selectNode],
	);

	const isValidConnection = useCallback<IsValidConnection>(
		(connection) => {
			const source = nodes.find((n) => n.id === connection.source);
			const target = nodes.find((n) => n.id === connection.target);
			if (!(source && target) || source.id === target.id) {
				return false;
			}
			return (
				connectionIssue(
					source.data.node,
					target.data.node,
					handleWhen(connection.sourceHandle),
				) === null
			);
		},
		[nodes],
	);

	const origin = useConnection(selectOrigin);
	const workflowNodes = useMemo(() => nodes.map((n) => n.data.node), [nodes]);
	const plan = useMemo(
		() => (origin ? planDrag(origin, workflowNodes, stepName) : null),
		[origin, workflowNodes, stepName],
	);

	const flowEdges = useMemo(() => {
		const byId = new Map(workflowNodes.map((node) => [node.id, node]));
		return edges.map((edge): TypedFlowEdge => {
			const source = byId.get(edge.source);
			return {
				...edge,
				type: "typed",
				data: {
					...edge.data,
					port: source
						? edgePort(source, handleWhen(edge.sourceHandle))
						: "pass",
				},
			};
		});
	}, [edges, workflowNodes]);

	const onConnectEnd = useCallback(
		(event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
			const { fromHandle } = state;
			const fromNode = nodes.find((n) => n.id === state.fromNode?.id);
			if (
				reconnecting.current ||
				readOnly ||
				state.isValid ||
				state.toHandle ||
				!(fromHandle && fromNode) ||
				fromHandle.type !== "source"
			) {
				return;
			}
			const point = eventPoint(event);
			const at = screenToFlowPosition(point);
			const port = handlePort(fromNode.data.node, fromHandle.id);
			const overToolbox =
				document
					.elementFromPoint(point.x, point.y)
					?.closest("[data-toolbox]") != null;
			const hit = overToolbox
				? undefined
				: getIntersectingNodes({ ...at, width: 1, height: 1 }).at(-1);
			if (hit) {
				if (
					hit.id !== fromNode.id &&
					acceptReason(hit.data.node.type, port) === null
				) {
					onConnect({
						source: fromNode.id,
						sourceHandle: fromHandle.id ?? null,
						target: hit.id,
						targetHandle: null,
					});
				}
				return;
			}
			setPending({
				nodeId: fromNode.id,
				handleId: fromHandle.id ?? null,
				port,
				at,
			});
		},
		[getIntersectingNodes, nodes, onConnect, readOnly, screenToFlowPosition],
	);

	const cancelPending = useCallback(() => setPending(null), []);

	useEffect(() => {
		if (!pending) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setPending(null);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [pending]);

	const currentDefinition = () => graphToCandidate(meta, nodes, edges);

	const applyDefinition = (next: WorkflowDefinition, select?: string) => {
		const graph = definitionToGraph(next);
		const previous = new Map(nodes.map((node) => [node.id, node]));
		setNodes(
			graph.nodes.map((node): TripwireFlowNode => {
				const before = previous.get(node.id);
				return before
					? { ...before, data: node.data, position: node.position }
					: { ...node, selected: node.id === select };
			}),
		);
		setEdges(graph.edges);
		setDirty(true);
	};

	const connectPending = (item: ToolboxItem) => {
		if (!pending) {
			return;
		}
		const node = buildNodeFromItem(item);
		const sourceExists = nodes.some((n) => n.id === pending.nodeId);
		if (!sourceExists || acceptReason(node.type, pending.port) !== null) {
			return;
		}
		const position = {
			x: pending.at.x - INPUT_HANDLE_OFFSET.x,
			y: pending.at.y - INPUT_HANDLE_OFFSET.y,
		};
		if (pending.insert) {
			if (node.type !== "rule") {
				return;
			}
			applyDefinition(
				insertStep(currentDefinition(), pending.insert.edgeId, {
					...node,
					position,
				}),
				node.id,
			);
			setPending(null);
			return;
		}
		insertNode(node, position);
		onConnect({
			source: pending.nodeId,
			sourceHandle: pending.handleId,
			target: node.id,
			targetHandle: null,
		});
		setPending(null);
	};

	const revealIds = (ids: string[]) => {
		const zoom = getZoom();
		fitView({
			...fitViewOptions(),
			nodes: ids.map((id) => ({ id })),
			duration: 200,
			minZoom: zoom,
			maxZoom: zoom,
		});
	};

	const revealProblem = (problem: Problem) => {
		const edge = problem.edgeId
			? edges.find((entry) => entry.id === problem.edgeId)
			: undefined;
		if (edge) {
			setNodes((current) => current.map((n) => ({ ...n, selected: false })));
			setEdges((current) =>
				current.map((entry) => ({ ...entry, selected: entry.id === edge.id })),
			);
			revealIds([edge.source, edge.target]);
			return;
		}
		if (problem.nodeId) {
			selectNode(problem.nodeId);
			revealIds([problem.nodeId]);
		}
	};

	const runIntent = (intent: LintIntent) => {
		setProblemsOpen(false);
		if (intent.type === "focus-field") {
			editField(intent.nodeId, intent.field);
			revealIds([intent.nodeId]);
			return;
		}
		if (intent.type === "insert-step") {
			const edge = edges.find((entry) => entry.id === intent.edgeId);
			const source = nodes.find((node) => node.id === edge?.source);
			const target = nodes.find((node) => node.id === edge?.target);
			if (!(edge && source && target)) {
				return;
			}
			clearSelection();
			setPending({
				nodeId: source.id,
				handleId: edge.sourceHandle ?? null,
				port: handlePort(source.data.node, edge.sourceHandle),
				at: handlePoint(
					openPosition(currentDefinition(), {
						x: Math.round((source.position.x + target.position.x) / 2),
						y: Math.round((source.position.y + target.position.y) / 2),
					}),
				),
				insert: { edgeId: edge.id },
			});
			return;
		}
		const node = nodes.find((entry) => entry.id === intent.nodeId);
		if (!node) {
			return;
		}
		clearSelection();
		setPending({
			nodeId: node.id,
			handleId: portHandleId(intent.port),
			port: intent.port,
			at: handlePoint(
				openPosition(currentDefinition(), {
					x:
						node.position.x +
						(node.measured?.width ?? CARD_WIDTH) +
						NEXT_STEP_GAP,
					y: node.position.y,
				}),
			),
		});
	};

	const fixProblem = (_problem: Problem, fix: LintFix) => {
		if ("intent" in fix) {
			runIntent(fix.intent);
			return;
		}
		const before = { nodes, edges };
		applyDefinition(applyLintEdit(currentDefinition(), fix.edit));
		const removal =
			fix.edit.type === "delete-node"
				? "Step deleted"
				: fix.edit.type === "remove-edge" || fix.edit.type === "keep-one-input"
					? "Connection deleted"
					: null;
		if (removal) {
			toast(removal, {
				action: {
					label: "Undo",
					onClick: () => {
						setNodes(before.nodes);
						setEdges(before.edges);
					},
				},
			});
		}
	};

	const problemHandlers = useRef({ fix: fixProblem, reveal: revealProblem });
	problemHandlers.current = { fix: fixProblem, reveal: revealProblem };
	const problemsApi = useMemo<ProblemsApi>(
		() => ({
			byNode: groupProblems(problems, "nodeId"),
			byEdge: groupProblems(problems, "edgeId"),
			onFix: (problem, fix) => problemHandlers.current.fix(problem, fix),
			onReveal: (problem) => problemHandlers.current.reveal(problem),
		}),
		[problems],
	);

	const toolboxConnect = pending
		? {
				port: pending.port,
				pending: true,
				insert: pending.insert !== undefined,
			}
		: plan?.direction === "out" && plan.port
			? { port: plan.port, pending: false }
			: null;

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
		if (pending) {
			connectPending(item);
			return;
		}
		const y =
			nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.y)) + 150 : 80;
		insertNode(buildNodeFromItem(item), { x: 80, y });
	};

	// ---- save ---------------------------------------------------------------
	const handleSave = async () => {
		const result = graphToDefinition(meta, nodes, edges);
		if (!result.ok) {
			toast.fail(result.error);
			return;
		}
		const saved = await onSave(result.definition).catch(() => ({
			ok: false as const,
			error:
				"Tripwire could not reach the server, so the workflow is not saved. Try again.",
			connectionIssues: undefined,
		}));
		if (saved.ok) {
			setDirty(false);
			const failed = saved.connectionIssues ?? [];
			setConnectionIssues(
				new Map(failed.map((issue) => [issue.nodeId, [issue.message]])),
			);
			if (failed.length > 0) {
				toast.warn(
					"Workflow saved, but Tripwire could not reach a delivery address. Open the marked step to fix it.",
				);
			} else if (enabled) {
				toast.success("Workflow saved");
			} else {
				toast.success("Saved. The workflow is still off.", {
					action: {
						label: "Turn on",
						onClick: () => handleSetEnabled(true),
					},
				});
			}
		} else {
			toast.fail(
				saved.error ?? "Tripwire could not save the workflow. Try again.",
			);
		}
	};

	const handleSetEnabled = async (next: boolean) => {
		const result = await onSetEnabled(next).catch(() => null);
		if (result === null) {
			toast.fail(
				"Tripwire could not reach the server, so the workflow did not change. Try again.",
			);
			return;
		}
		if (result.ok) {
			toast.success(
				result.enabled ? "Workflow turned on" : "Workflow turned off",
			);
		} else {
			setServerIssues({ against: lintResults, issues: result.issues });
			const errors = result.issues.filter(
				(issue) => (issue.severity ?? "error") === "error",
			);
			toast.fail(
				`${problemCount(errors.map(serverProblem))} ${errors.length === 1 ? "keeps" : "keep"} the workflow off`,
				{
					action: {
						label: "Show problems",
						onClick: () => setProblemsOpen(true),
					},
				},
			);
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
				onShowProblems={() => setProblemsOpen(true)}
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
						<ProblemsContext.Provider value={problemsApi}>
							<EditFieldContext.Provider value={editField}>
								<DragPlanContext.Provider value={plan}>
									<ReactFlow
										connectionLineComponent={TypedConnectionLine}
										data-drag-tone={
											plan?.port ? WORKFLOW_PORT_TONE[plan.port] : undefined
										}
										deleteKeyCode={readOnly ? null : DELETE_KEYS}
										onBeforeDelete={readOnly ? undefined : onBeforeDelete}
										edges={flowEdges}
										edgeTypes={EDGE_TYPES}
										edgesReconnectable={!readOnly}
										elementsSelectable
										fitView
										fitViewOptions={fitViewOptions()}
										isValidConnection={isValidConnection}
										nodes={nodes}
										nodesConnectable={!readOnly}
										nodesDraggable={!readOnly}
										nodeTypes={NODE_TYPES}
										onConnect={readOnly ? undefined : onConnect}
										onConnectEnd={onConnectEnd}
										onConnectStart={cancelPending}
										onNodeClick={cancelPending}
										onPaneClick={cancelPending}
										onReconnectEnd={() => {
											reconnecting.current = false;
										}}
										onReconnectStart={() => {
											reconnecting.current = true;
										}}
										onEdgesChange={onEdgesChange}
										onNodesChange={onNodesChange}
										onReconnect={readOnly ? undefined : onReconnect}
										proOptions={{ hideAttribution: true }}
										style={CANVAS_TOKENS}
									>
										<Controls
											className="!m-3 overflow-hidden rounded-overlay border border-line"
											position="bottom-right"
											showInteractive={false}
										/>
										<DropHint />
										{pending ? <PendingConnection {...pending} /> : null}
									</ReactFlow>
								</DragPlanContext.Provider>
							</EditFieldContext.Provider>
						</ProblemsContext.Provider>
					</CustomRuleNamesContext.Provider>
					<EditorSidebar
						connect={toolboxConnect}
						customRules={customRules}
						onCancelConnect={cancelPending}
						fieldFocus={fieldFocus}
						onFieldFocused={() => setFieldFocus(null)}
						org={org}
						repo={repo}
						onAdd={addAtFreePosition}
						onClearSelection={clearSelection}
						onTestConnection={onTestConnection}
						onUpdateNode={updateNode}
						readOnly={readOnly}
						selectedNode={selectedNode}
					/>
					<ProblemsButton
						onFix={fixProblem}
						onOpenChange={setProblemsOpen}
						onReveal={revealProblem}
						open={problemsOpen}
						problems={problems}
					/>
					{nodes.length === 0 ? (
						<div className="pointer-events-none absolute inset-0 grid place-items-center">
							<p className="type-body-sm text-text-2">
								Drag a step from the toolbox, or press its add button
							</p>
						</div>
					) : null}
				</CanvasDropzone>
				<DragOverlay dropAnimation={null}>
					{dragged ? (
						<div className="overlay rounded-panel px-2 py-1 type-label-sm">
							{dragged.name}
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
			<Dialog
				onOpenChange={(open) => {
					if (!open && leave.status === "blocked") {
						leave.reset();
					}
				}}
				open={leave.status === "blocked"}
				role="alertdialog"
			>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Leave without saving?</DialogTitle>
						<DialogDescription>
							Your changes to this workflow are not saved. If you leave now,
							they are lost.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose>Keep editing</DialogClose>
						<DialogAction
							onAction={() => {
								if (leave.status === "blocked") {
									leave.proceed();
								}
							}}
							variant="destructive"
						>
							Leave without saving
						</DialogAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
