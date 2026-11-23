import { Card } from "@tripwire/ui/card";
import { Label, SupportingText } from "@tripwire/ui/typography";
import { useDeferredValue, useMemo } from "react";
import { TripwireCodeDiff, TripwireCodeFile } from "#/components/code";
import type { WorkflowCodeView } from "#/lib/workflow-code-view";
import "./workflow-code.css";

const FILE_NAME = "tripwire.ts";

export interface WorkflowCodeProps {
	view: WorkflowCodeView;
	unsaved: boolean;
}

export interface WorkflowCodeRenderSnapshot extends WorkflowCodeProps {
	pending: boolean;
}

export function workflowCodeRenderSnapshot(
	current: WorkflowCodeProps,
	deferred: WorkflowCodeProps,
): WorkflowCodeRenderSnapshot {
	return { ...deferred, pending: current !== deferred };
}

export function WorkflowCode({ view, unsaved }: WorkflowCodeProps) {
	const current = useMemo(() => ({ view, unsaved }), [view, unsaved]);
	const deferred = useDeferredValue(current);
	return (
		<WorkflowCodeSnapshot
			snapshot={workflowCodeRenderSnapshot(current, deferred)}
		/>
	);
}

export function WorkflowCodeSnapshot({
	snapshot: rendered,
}: {
	snapshot: WorkflowCodeRenderSnapshot;
}) {
	return (
		<div
			aria-busy={rendered.pending || undefined}
			data-layout-role="workflow-code-scroll"
			data-update-pending={rendered.pending ? "" : undefined}
		>
			{rendered.pending ? (
				<output className="sr-only">Updating code preview</output>
			) : null}
			<div data-layout-role="workflow-code-content">
				{rendered.view.kind === "code" ? (
					<>
						{rendered.view.warnings.length > 0 ? (
							<ul data-layout-role="workflow-code-warnings">
								{rendered.view.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						) : null}
						{rendered.unsaved && rendered.view.saved !== null ? (
							<TripwireCodeDiff
								after={rendered.view.code}
								before={rendered.view.saved}
								name={FILE_NAME}
							/>
						) : (
							<TripwireCodeFile
								code={rendered.view.code}
								lineAnchors
								name={FILE_NAME}
							/>
						)}
					</>
				) : (
					<Card data-layout-role="workflow-code-refusal-card">
						<div data-layout-role="workflow-code-refusal">
							<Label as="div">This workflow cannot be written as code</Label>
							<SupportingText>{rendered.view.reason}</SupportingText>
						</div>
					</Card>
				)}
			</div>
		</div>
	);
}
