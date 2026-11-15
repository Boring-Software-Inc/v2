import { Card } from "@tripwire/ui/card";
import { Label, SupportingText } from "@tripwire/ui/typography";
import { TripwireCodeDiff, TripwireCodeFile } from "#/components/code";
import type { WorkflowCodeView } from "#/lib/workflow-code-view";
import "./workflow-code.css";

const FILE_NAME = "tripwire.ts";

export interface WorkflowCodeProps {
	view: WorkflowCodeView;
	unsaved: boolean;
}

export function WorkflowCode({ view, unsaved }: WorkflowCodeProps) {
	return (
		<div data-layout-role="workflow-code-scroll">
			<div data-layout-role="workflow-code-content">
				{view.kind === "code" ? (
					<>
						{view.warnings.length > 0 ? (
							<ul data-layout-role="workflow-code-warnings">
								{view.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						) : null}
						{unsaved && view.saved !== null ? (
							<TripwireCodeDiff
								after={view.code}
								before={view.saved}
								name={FILE_NAME}
							/>
						) : (
							<TripwireCodeFile code={view.code} lineAnchors name={FILE_NAME} />
						)}
					</>
				) : (
					<Card data-layout-role="workflow-code-refusal-card">
						<div data-layout-role="workflow-code-refusal">
							<Label as="div">This workflow cannot be written as code</Label>
							<SupportingText>{view.reason}</SupportingText>
						</div>
					</Card>
				)}
			</div>
		</div>
	);
}
