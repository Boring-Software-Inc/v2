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
import { Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { StatusMark } from "#/components/glaze/ui/status";
import {
	NodeAgentOutline,
	NodeEnterDissolve,
} from "#/components/workflows/editor/agent-work-context";
import {
	fieldListItems,
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import {
	useCustomRuleName,
	useEditField,
	useNodeProblems,
	useProblems,
} from "#/components/workflows/editor/node-issues";
import {
	ProblemPeek,
	severityStatus,
} from "#/components/workflows/editor/problems-list";
import { stepIcon, stepName } from "#/components/workflows/editor/step-meta";
import {
	useDragPlan,
	useNodeVerdict,
} from "#/components/workflows/editor/typed-connections";
import { cn } from "#/lib/glaze/utils";
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
		<span
			className={cn(
				"shrink-0 type-caption transition-colors duration-(--dur-state)",
				tone === "ok" && "text-ok-text",
				tone === "fail" && "text-fail-text",
				tone === "neutral" && "text-text-3",
			)}
		>
			{WORKFLOW_PORT_LABELS[port]}
		</span>
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
	const problems = useNodeProblems(node.id);
	const { onFix } = useProblems();
	const status = problems.length > 0 ? severityStatus(problems) : null;
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
		<>
			<div
				data-drop-node={nodeDrop}
				className={cn(
					"relative w-56 rounded-panel border border-line-faint bg-paper px-3 py-2 text-text-1 transition-colors duration-(--dur-state)",
					cornerPort && "min-h-16",
					selected && "border-ink",
					status === "fail" && !selected && "border-fail",
					status === "warn" && !selected && "border-warn",
				)}
			>
				<NodeAgentOutline nodeId={node.id} />
				{status ? (
					<ProblemPeek
						className="absolute -top-2 -right-2 flex rounded-pill bg-paper"
						onFix={onFix}
						problems={problems}
					>
						<StatusMark
							label={problems.map((problem) => problem.message).join(". ")}
							status={status}
						/>
					</ProblemPeek>
				) : null}
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
				<div className="flex items-center gap-2">
					<Icon
						className={cn("shrink-0 text-text-1", input && "-ms-1.5")}
						icon={stepIcon(node)}
					/>
					<span className="min-w-0 type-label [overflow-wrap:anywhere]">
						{faceTitle(node, customName)}
					</span>
					{node.type === "gate" ? (
						<span className="shrink-0 type-caption text-text-2">Gate</span>
					) : null}
					{topPort && node.type !== "trigger" ? (
						<span className="ms-auto flex">
							<PortCaption linked={topLinked} port={topPort} />
						</span>
					) : null}
				</div>
				{detail ? (
					<div className="type-code-xs text-text-3 [overflow-wrap:anywhere]">
						{detail}
					</div>
				) : null}
				{fields.length > 0 ? (
					<div className="mt-2 flex flex-col border-line-faint border-t pt-1">
						{fields.map(({ field, value }) => {
							const unset = value === undefined || value === null;
							const bare = field.key === "message" && !unset;
							const items = fieldListItems(field, value);
							return (
								<div className="-mx-2.5" key={field.key}>
									<Button
										aria-label={`Edit ${field.label}`}
										className="h-auto min-h-7 w-full items-start justify-between gap-x-3 whitespace-normal py-1 text-start"
										onClick={() => editField(node.id, field.key)}
										size="sm"
										variant="ghost"
									>
										{bare ? null : (
											<span className="shrink-0 whitespace-nowrap text-text-2">
												{field.label}
											</span>
										)}
										<span
											className={cn(
												"min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]",
												bare ? "w-full" : "text-end",
												unset && "text-text-3",
											)}
										>
											{items
												? items.map((item, index) => (
														<Fragment key={item}>
															{index > 0 ? " " : null}
															<span className="inline-block max-w-full">
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
					<div className="mt-1 flex justify-end">
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
						drop={dropState(
							verdict,
							portHandleId(cornerPort),
							"out",
							direction,
						)}
						linked={cornerLinked}
						port={cornerPort}
					/>
				) : null}
			</div>
			<NodeEnterDissolve nodeId={node.id} />
		</>
	);
}
