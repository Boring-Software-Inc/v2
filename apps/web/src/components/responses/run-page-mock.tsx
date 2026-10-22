import { memo, useMemo } from "react";
import { verdictStatus } from "#/components/activity/verdict-chip";
import { Status } from "#/components/glaze/ui/status";
import { PreviewObject } from "#/components/responses/preview-object";
import { SAMPLE_RUN } from "#/components/responses/sample-run";
import { StepCard } from "#/components/runs/step-card";
import { useChangeCount } from "#/hooks/use-change-count";
import { toPublicRunView } from "#/lib/run-access";

export const RunPageMock = memo(function RunPageMock({
	level,
}: {
	level: number;
}) {
	const view = useMemo(() => toPublicRunView(SAMPLE_RUN, level), [level]);
	const verdict = verdictStatus(view.verdict);
	const changes = useChangeCount(level);
	return (
		<PreviewObject>
			<div className="flex flex-col">
				<div className="flex items-center gap-3 px-4 py-3">
					<span className="min-w-0 flex-1 truncate type-label">
						{view.repoFullName} #{view.subjectNumber}
					</span>
					{verdict ? (
						<Status status={verdict.status}>{verdict.label}</Status>
					) : null}
				</div>
				{view.stepsHidden ? null : (
					<div
						className="border-line-faint border-t"
						data-redact-wipe={changes > 0 ? "" : undefined}
						key={changes}
					>
						{view.steps.map((step) => (
							<StepCard
								key={step.id}
								maintainer={false}
								repo={view.repoFullName}
								sha={view.headSha}
								step={step}
							/>
						))}
					</div>
				)}
			</div>
		</PreviewObject>
	);
});
