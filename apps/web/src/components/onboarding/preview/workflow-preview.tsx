import {
	arrangeWorkflow,
	edgePort,
	type OnboardingRepo,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import { Icon, Pending } from "@tripwire/ui/icon";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMemo } from "react";
import { PreviewWindow } from "#/components/onboarding/preview/preview-window";
import {
	estimateCardHeight,
	LANE_SPACING,
} from "#/components/workflows/editor/lane-layout";
import { TripwireNode } from "#/components/workflows/editor/node-card";
import { TypedEdge } from "#/components/workflows/editor/typed-connections";
import { definitionToGraph } from "#/lib/workflow-editor";
import "@xyflow/react/dist/style.css";

const NODE_TYPES = { tripwire: TripwireNode };
/** Full size, from the top left: like the window, the canvas runs off the edge. */
const CANVAS_VIEWPORT = { x: 48, y: 72, zoom: 1 };
const EDGE_TYPES = { typed: TypedEdge };

/**
 * The drafted workflow on the editor's own canvas, laid out by the editor's
 * auto-arrange and shown read-only, with the badge the editor shows a draft.
 */
export function WorkflowPreviewPage({
	org,
	repo,
	definition,
}: {
	org: string;
	repo: OnboardingRepo | null;
	definition: WorkflowDefinition | null;
}) {
	const graph = useMemo(() => {
		if (!definition) {
			return null;
		}
		const arranged = arrangeWorkflow(definition, {
			spacing: LANE_SPACING,
			heightOf: estimateCardHeight,
		});
		const { nodes, edges } = definitionToGraph(arranged);
		const byId = new Map(arranged.nodes.map((node) => [node.id, node]));
		return {
			nodes: nodes.map((node) => ({ ...node, type: "tripwire" as const })),
			edges: edges.map((edge) => {
				const source = byId.get(edge.source);
				return {
					...edge,
					type: "typed" as const,
					data: {
						when: edge.data?.when,
						port: source ? edgePort(source, edge.data?.when) : "pass",
					},
				};
			}),
		};
	}, [definition]);

	return (
		<PreviewWindow
			url={{
				host: "app.tripwire.sh",
				path: repo ? `/${org}/${repo.name}/workflows` : `/${org}/home`,
			}}
		>
			<div data-layout-role="onboarding-workflow-page">
				<header data-part="header">
					<Badge variant="outline">Draft preview</Badge>
				</header>
				<div data-part="canvas">
					{graph ? (
						<ReactFlowProvider>
							<ReactFlow
								edgeTypes={EDGE_TYPES}
								edges={graph.edges}
								defaultViewport={CANVAS_VIEWPORT}
								elementsSelectable={false}
								nodeTypes={NODE_TYPES}
								nodes={graph.nodes}
								nodesConnectable={false}
								nodesDraggable={false}
								panOnDrag={false}
								proOptions={{ hideAttribution: true }}
								zoomOnDoubleClick={false}
								zoomOnPinch={false}
								zoomOnScroll={false}
							/>
						</ReactFlowProvider>
					) : (
						// Still drafting: the editor's own loading state.
						<span data-part="spinner">
							<Icon icon={Pending} motion="spin" />
						</span>
					)}
				</div>
			</div>
		</PreviewWindow>
	);
}
