import type { WorkflowDefinition, WorkflowNode } from "@tripwire/contracts";
import { RULE_CATALOG } from "@tripwire/contracts";
import {
	addEdge,
	Background,
	type Connection,
	Controls,
	type Edge,
	type Node,
	ReactFlow,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { TripwireNode } from "#/components/workflows/editor/node-card";
import {
	definitionToGraph,
	type EditorEdge,
	type EditorNode,
	graphToDefinition,
	handleWhen,
} from "#/lib/workflow-editor";
import "@xyflow/react/dist/style.css";

const NODE_TYPES = { tripwire: TripwireNode };

export interface CanvasProps {
	definition: WorkflowDefinition;
	onSave: (definition: WorkflowDefinition) => void;
	saving: boolean;
}

let addCounter = 0;

export function WorkflowCanvas({ definition, onSave, saving }: CanvasProps) {
	const initial = useMemo(() => definitionToGraph(definition), [definition]);
	const [nodes, setNodes, onNodesChange] = useNodesState(
		initial.nodes as Node[],
	);
	const [edges, setEdges, onEdgesChange] = useEdgesState(
		initial.edges as Edge[],
	);
	const [error, setError] = useState<string | null>(null);

	const onConnect = useCallback(
		(connection: Connection) => {
			const when = handleWhen(connection.sourceHandle);
			setEdges((current) =>
				addEdge(
					{
						...connection,
						id: `edge-${++addCounter}`,
						...(when ? { label: when } : {}),
					},
					current,
				),
			);
		},
		[setEdges],
	);

	const addNode = (node: WorkflowNode) => {
		setNodes((current) => [
			...current,
			{
				id: node.id,
				position: { x: 80 + current.length * 24, y: 80 + current.length * 24 },
				data: { node },
				type: "tripwire",
			} as Node,
		]);
	};

	const save = () => {
		const result = graphToDefinition(
			{
				id: definition.id,
				name: definition.name,
				version: definition.version,
			},
			nodes as unknown as EditorNode[],
			edges as unknown as EditorEdge[],
		);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		setError(null);
		onSave(result.definition);
	};

	return (
		<div className="flex h-full flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<AddMenu label="+ rule" onAdd={addNode} variant="rule" />
				<AddMenu label="+ gate" onAdd={addNode} variant="gate" />
				<AddMenu label="+ action" onAdd={addNode} variant="action" />
				<button
					className="ml-auto rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
					disabled={saving}
					onClick={save}
					type="button"
				>
					{saving ? "saving…" : "save workflow"}
				</button>
			</div>
			{error ? <p className="text-red-500 text-xs">{error}</p> : null}
			<div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
				<ReactFlow
					edges={edges}
					fitView
					nodes={nodes}
					nodeTypes={NODE_TYPES}
					onConnect={onConnect}
					onEdgesChange={onEdgesChange}
					onNodesChange={onNodesChange}
					proOptions={{ hideAttribution: true }}
				>
					<Background gap={16} />
					<Controls showInteractive={false} />
				</ReactFlow>
			</div>
		</div>
	);
}

function AddMenu({
	label,
	variant,
	onAdd,
}: {
	label: string;
	variant: "rule" | "gate" | "action";
	onAdd: (node: WorkflowNode) => void;
}) {
	const [open, setOpen] = useState(false);
	const options: { key: string; node: () => WorkflowNode }[] =
		variant === "rule"
			? RULE_CATALOG.map((entry) => ({
					key: `${entry.ruleId}@${entry.version}`,
					node: () =>
						({
							id: `${entry.ruleId}-${++addCounter}`,
							type: "rule",
							ref: `${entry.ruleId}@${entry.version}`,
							config: structuredClone(entry.defaultConfig) as never,
						}) satisfies WorkflowNode,
				}))
			: variant === "gate"
				? (["all-of", "any-of", "not"] as const).map((mode) => ({
						key: mode,
						node: () => ({ id: `gate-${++addCounter}`, type: "gate", mode }),
					}))
				: (
						[
							"block",
							"comment",
							"label",
							"request-review",
							"send-to-moderation",
						] as const
					).map((action) => ({
						key: action,
						node: () => ({
							id: `${action}-${++addCounter}`,
							type: "action",
							action,
						}),
					}));

	return (
		<div className="relative">
			<button
				className="rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-1"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				{label}
			</button>
			{open ? (
				<div className="absolute top-full left-0 z-10 mt-1 flex min-w-44 flex-col rounded-md border bg-popover py-1 shadow-md">
					{options.map((option) => (
						<button
							className="px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-surface-1"
							key={option.key}
							onClick={() => {
								onAdd(option.node());
								setOpen(false);
							}}
							type="button"
						>
							{option.key}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
