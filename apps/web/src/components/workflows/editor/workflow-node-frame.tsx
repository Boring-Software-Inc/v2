import type { ReactNode } from "react";
import {
	NodeAgentOutline,
	NodeEnterDissolve,
} from "#/components/workflows/editor/agent-work-context";
import {
	useNodeProblems,
	useProblems,
} from "#/components/workflows/editor/node-issues";
import {
	ProblemPeek,
	severityStatus,
} from "#/components/workflows/editor/problems-list";
import { StatusMark } from "#/design-system/ui/status";

interface WorkflowNodeFrameProps {
	nodeId: string;
	selected: boolean;
	cornerOutput?: boolean;
	dropState?: "origin" | "open" | "closed";
	children: ReactNode;
}

/** Handles stay direct children so React Flow measures the same node and ports. */
export function WorkflowNodeFrame({
	nodeId,
	selected,
	cornerOutput = false,
	dropState,
	children,
}: WorkflowNodeFrameProps) {
	const problems = useNodeProblems(nodeId);
	const { onFix } = useProblems();
	const status = problems.length > 0 ? severityStatus(problems) : null;
	return (
		<>
			<div
				data-layout-role="workflow-node-frame"
				data-selected={selected || undefined}
				data-problem-status={status ?? undefined}
				data-corner-output={cornerOutput || undefined}
				data-drop-node={dropState}
			>
				<NodeAgentOutline nodeId={nodeId} />
				{status ? (
					<ProblemPeek
						className="workflow-node-problem"
						onFix={onFix}
						problems={problems}
					>
						<StatusMark
							label={problems.map((problem) => problem.message).join(". ")}
							status={status}
						/>
					</ProblemPeek>
				) : null}
				{children}
			</div>
			<NodeEnterDissolve nodeId={nodeId} />
		</>
	);
}
