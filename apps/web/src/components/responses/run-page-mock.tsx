import { AnimatePresence, motion } from "motion/react";
import { memo, useMemo } from "react";
import { verdictStatus } from "#/components/activity/verdict-chip";
import { AnimatedHeight } from "#/components/common/animated-height";
import { Status } from "#/components/glaze/ui/status";
import {
	BLUR_SWAP,
	keyedByContent,
} from "#/components/responses/preview-motion";
import { PreviewObject } from "#/components/responses/preview-object";
import { SAMPLE_RUN } from "#/components/responses/sample-run";
import { StepCard } from "#/components/runs/step-card";
import { toPublicRunView } from "#/lib/run-access";

export const RunPageMock = memo(function RunPageMock({
	level,
}: {
	level: number;
}) {
	const view = useMemo(() => toPublicRunView(SAMPLE_RUN, level), [level]);
	const verdict = verdictStatus(view.verdict);
	const steps = keyedByContent(view.steps, (step) => JSON.stringify(step));
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
				<AnimatedHeight>
					<AnimatePresence initial={false}>
						{view.stepsHidden ? null : (
							<motion.div
								className="border-line-faint border-t"
								key="steps"
								{...BLUR_SWAP}
							>
								<AnimatePresence initial={false} mode="popLayout">
									{steps.map(({ item: step, key }) => (
										<motion.div key={key} layout="position" {...BLUR_SWAP}>
											<StepCard
												maintainer={false}
												repo={view.repoFullName}
												sha={view.headSha}
												step={step}
											/>
										</motion.div>
									))}
								</AnimatePresence>
							</motion.div>
						)}
					</AnimatePresence>
				</AnimatedHeight>
			</div>
		</PreviewObject>
	);
});
