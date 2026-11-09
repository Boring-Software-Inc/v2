import type { WorkflowNode, WorkflowPort } from "@tripwire/contracts";
import {
	handleReason,
	inputLook,
	inputSummary,
	type NodeVerdict,
	outputLook,
	outputPorts,
	portHandleId,
	WORKFLOW_PORT_LABELS,
	WORKFLOW_PORT_TONE,
} from "@tripwire/contracts";
import {
	Handle,
	type Node,
	type NodeConnection,
	type NodeProps,
	Position,
	useNodeConnections,
} from "@xyflow/react";
import { Fragment } from "react";
import {
	fieldListItems,
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import {
	useCustomRuleName,
	useEditField,
} from "#/components/workflows/editor/node-issues";
import { stepIcon, stepName } from "#/components/workflows/editor/step-meta";
import {
	useDragPlan,
	useNodeVerdict,
} from "#/components/workflows/editor/typed-connections";
import { WorkflowNodeFrame } from "#/components/workflows/editor/workflow-node-frame";
import { Icon } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { Caption, CodeText, Label } from "#/design-system/ui/typography";
import { triggerPath } from "#/lib/trigger-kinds";

/** The one node data shape the canvas renders. */
export type TripwireFlowNode = Node<{ node: WorkflowNode }, "tripwire">;

/**
 * One visual for all four node kinds. Type reads from STRUCTURE AND WORDS,
 * not hue: the name, the mono ref/mode line, the field rows, and the port
 * layout announce what a node is. The only color on a card is semantic — the
 * ok/fail outcome ports and the fail mark on an invalid node. Gates alone carry
 * a plain text kind label; with no body, the word is their only type signal.
 * Body is the catalog name plus, for value-accepting nodes, inline field rows
 * summarizing the config the properties panel edits (same schema walk,
 * node-fields.ts; a row click opens the panel on that field). Selected = strong
 * line; invalid = fail mark that previews its problems on hover. Handle ids are LOAD-BEARING:
 * `handleWhen` maps "fail" / "approve" / "deny" handle ids to edge `when`s —
 * the port blocks are appearance only, every id and type is unchanged.
 */

function faceTitle(node: WorkflowNode, customName: string | null): string {
	if (node.type === "trigger") {
		return triggerPath(node) === "schedule" ? "On a schedule" : "On an event";
	}
	return stepName(node, customName);
}

/** The mono detail line — the ref/config essence under the name. */
function nodeDetail(node: WorkflowNode): string | null {
	switch (node.type) {
		case "rule":
			return node.ref;
		case "gate":
			return node.mode;
		default:
			return null;
	}
}

type DropState = "open" | "closed" | undefined;

function OutputPort({
	port,
	corner,
	drop,
	linked,
}: {
	port: WorkflowPort;
	corner: boolean;
	drop: DropState;
	linked: boolean;
}) {
	const look = outputLook(port);
	return (
		<Handle
			data-drop={drop}
			data-port-linked={linked || undefined}
			data-port-io="out"
			data-port-negated={look.negated || undefined}
			data-port-shape={look.shape}
			data-port-slot={corner ? "corner" : "top"}
			data-port-tone={look.tone}
			id={portHandleId(port) ?? undefined}
			position={Position.Right}
			title={WORKFLOW_PORT_LABELS[port]}
			type="source"
		/>
	);
}

function PortCaption({
	port,
	linked,
}: {
	port: WorkflowPort;
	linked: boolean;
}) {
	const tone = linked ? WORKFLOW_PORT_TONE[port] : "neutral";
	return (
		<Caption
			data-layout-role="workflow-node-port-caption"
			data-port-tone={tone}
		>
			{WORKFLOW_PORT_LABELS[port]}
		</Caption>
	);
}

function linkedFrom(
	connections: readonly NodeConnection[],
	port: WorkflowPort | undefined,
): boolean {
	if (!port) {
		return false;
	}
	const handleId = portHandleId(port);
	return connections.some(
		(connection) => (connection.sourceHandle ?? null) === handleId,
	);
}

function dropState(
	verdict: NodeVerdict | null,
	handleId: string | null,
	io: "in" | "out",
	direction: "in" | "out" | undefined,
): DropState {
	if (!verdict || verdict.origin || direction === undefined) {
		return undefined;
	}
	if ((direction === "out") !== (io === "in")) {
		return undefined;
	}
	return handleReason(verdict, handleId) === null ? "open" : "closed";
}

export function TripwireNode({ data, selected }: NodeProps<TripwireFlowNode>) {
	const { node } = data;
	const editField = useEditField();
	const customName = useCustomRuleName(node.type === "rule" ? node.ref : "");
	const detail = nodeDetail(node);
	const fields = nodeFieldValues(node);
	const [topPort, cornerPort] = outputPorts(node);
	const input = inputLook(node.type);
	const verdict = useNodeVerdict(node.id);
	const direction = useDragPlan()?.direction;
	const outgoing = useNodeConnections({ handleType: "source" });
	const incoming = useNodeConnections({ handleType: "target" });
	const topLinked = linkedFrom(outgoing, topPort);
	const cornerLinked = linkedFrom(outgoing, cornerPort);
	const nodeDrop = verdict
		? verdict.origin
			? "origin"
			: verdict.reason
				? "closed"
				: "open"
		: undefined;
	return (
		<WorkflowNodeFrame
			nodeId={node.id}
			selected={selected}
			cornerOutput={Boolean(cornerPort)}
			dropState={nodeDrop}
		>
			{input ? (
				<Handle
					data-drop={dropState(verdict, null, "in", direction)}
					data-port-io="in"
					data-port-linked={incoming.length > 0 || undefined}
					data-port-shape={input.shape}
					data-port-slot="top"
					data-port-tone={input.tone}
					isConnectableStart={false}
					position={Position.Left}
					title={inputSummary(node.type)
						.map((entry) => entry.label)
						.join(", ")}
					type="target"
				/>
			) : null}
			<div data-layout-role="workflow-node-heading">
				<Icon
					data-layout-role="workflow-node-icon"
					data-has-input={Boolean(input) || undefined}
					icon={stepIcon(node)}
				/>
				<Label data-layout-role="workflow-node-title">
					{faceTitle(node, customName)}
				</Label>
				{node.type === "gate" ? (
					<Caption data-layout-role="workflow-node-kind">Gate</Caption>
				) : null}
				{topPort && node.type !== "trigger" ? (
					<span data-layout-role="workflow-node-top-output">
						<PortCaption linked={topLinked} port={topPort} />
					</span>
				) : null}
			</div>
			{detail ? (
				<CodeText as="span" data-layout-role="workflow-node-detail">
					{detail}
				</CodeText>
			) : null}
			{fields.length > 0 ? (
				<div data-layout-role="workflow-node-fields">
					{fields.map(({ field, value }) => {
						const unset = value === undefined || value === null;
						const bare = field.key === "message" && !unset;
						const items = fieldListItems(field, value);
						return (
							<div data-layout-role="workflow-node-field" key={field.key}>
								<Button
									aria-label={`Edit ${field.label}`}
									data-layout-role="workflow-node-field-action"
									onClick={() => editField(node.id, field.key)}
									size="sm"
									variant="ghost"
								>
									{bare ? null : (
										<span data-layout-role="workflow-node-field-label">
											{field.label}
										</span>
									)}
									<span
										data-layout-role="workflow-node-field-value"
										data-message={bare || undefined}
										data-unset={unset || undefined}
									>
										{items
											? items.map((item, index) => (
													<Fragment key={item}>
														{index > 0 ? " " : null}
														<span data-layout-role="workflow-node-field-item">
															{index < items.length - 1 ? `${item},` : item}
														</span>
													</Fragment>
												))
											: summarizeFieldValue(field, value)}
									</span>
								</Button>
							</div>
						);
					})}
				</div>
			) : null}
			{cornerPort ? (
				<div data-layout-role="workflow-node-corner-output">
					<PortCaption linked={cornerLinked} port={cornerPort} />
				</div>
			) : null}
			{topPort ? (
				<OutputPort
					corner={false}
					drop={dropState(verdict, portHandleId(topPort), "out", direction)}
					linked={topLinked}
					port={topPort}
				/>
			) : null}
			{cornerPort ? (
				<OutputPort
					corner
					drop={dropState(verdict, portHandleId(cornerPort), "out", direction)}
					linked={cornerLinked}
					port={cornerPort}
				/>
			) : null}
		</WorkflowNodeFrame>
	);
}
