import { memo, useMemo } from "react";
import { AnimatedHeight } from "#/components/common/animated-height";
import { PreviewObject } from "#/components/responses/preview-object";
import { RunChainView, RunStatusMark } from "#/components/runs/run-chain";
import { toPublicRunView } from "#/lib/run-access";
import { buildRunChain } from "#/lib/run-chain";
import type { RunView } from "#/lib/runs.functions";

export const RunPageMock = memo(function RunPageMock({
	run,
	level,
}: {
	run: RunView;
	level: number;
}) {
	const view = useMemo(() => toPublicRunView(run, level), [run, level]);
	const chain = useMemo(() => buildRunChain(view), [view]);
	return (
		<PreviewObject>
			<div className="flex flex-col">
				<div className="flex items-center gap-3 px-4 py-3">
					<span className="min-w-0 flex-1 truncate type-label">
						{view.repoFullName} #{view.subjectNumber}
					</span>
					<RunStatusMark outcome={chain.outcome} />
				</div>
				<AnimatedHeight>
					<div className="border-line-faint border-t px-4 pt-4 pb-4">
						<RunChainView
							chain={chain}
							context={{
								level: view.redactionLevel,
								maintainer: false,
								repo: view.repoFullName,
								sha: view.headSha,
							}}
						/>
					</div>
				</AnimatedHeight>
			</div>
		</PreviewObject>
	);
});
