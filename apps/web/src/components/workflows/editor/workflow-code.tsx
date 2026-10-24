import { TripwireCodeDiff, TripwireCodeFile } from "#/components/code";
import { Card } from "#/components/glaze/ui/card";
import type { WorkflowCodeView } from "#/lib/workflow-code-view";

const FILE_NAME = "tripwire.ts";

export interface WorkflowCodeProps {
	view: WorkflowCodeView;
	unsaved: boolean;
}

export function WorkflowCode({ view, unsaved }: WorkflowCodeProps) {
	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<div className="mx-auto flex w-full max-w-190 flex-col gap-3 px-3 pt-6 pb-8 sm:px-6">
				{view.kind === "code" ? (
					<>
						{view.warnings.length > 0 ? (
							<ul className="flex flex-col gap-1 type-body-sm text-text-2">
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
					<Card>
						<div className="flex flex-col gap-1 p-4">
							<p className="type-label text-text-1">
								This workflow cannot be written as code
							</p>
							<p className="type-body-sm text-text-2">{view.reason}</p>
						</div>
					</Card>
				)}
			</div>
		</div>
	);
}
