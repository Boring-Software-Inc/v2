import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@tripwire/ui/button";
import { UI_MOTION } from "@tripwire/ui/motion";
import { Skeleton } from "@tripwire/ui/skeleton";
import { notify } from "@tripwire/ui/toast";
import { AnimatePresence, motion } from "motion/react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";
import { newestReportedRunId } from "#/components/onboarding/preview/reported-run";
import { RunPreview } from "#/components/onboarding/preview/run-preview";
import { WorkflowPreviewPage } from "#/components/onboarding/preview/workflow-preview";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { saveOnboardingWorkflow } from "#/lib/onboarding-flow.functions";
import { onboardingWorkflowQueryOptions } from "#/lib/onboarding-flow.query";

const copy = ONBOARDING_COPY.workflow;

/** Reported re-runs may still be finishing, so the draft keeps catching up. */
const DRAFT_REFRESH_MS = 4_000;

function useWorkflowDraft(flow: StepViewProps["flow"]) {
	const org = flow.state.orgSlug ?? flow.state.personalOrgSlug ?? "";
	const repo = flow.state.repo;
	const reported = flow.state.answers.reported;
	const draft = useQuery({
		...onboardingWorkflowQueryOptions(org, repo?.id ?? "", reported),
		enabled: repo !== null && reported.length > 0,
		refetchInterval: DRAFT_REFRESH_MS,
	});
	return { org, repo, reported, draft };
}

/**
 * Step 8: the workflow drafted from what they reported. Saving creates it and
 * turns it on; "Not now" leaves nothing behind.
 */
export function WorkflowStep({ flow }: StepViewProps) {
	const { org, repo, reported, draft } = useWorkflowDraft(flow);
	const save = useMutation({
		mutationFn: () =>
			saveOnboardingWorkflow({
				data: { org, repoId: repo?.id ?? "", numbers: reported },
			}),
		onSuccess: (result) => {
			if (result.status === "saved") {
				notify.show({ title: copy.saved });
			}
			flow.advance({
				answers: {
					workflowId:
						result.status === "nothing-failed" ? null : result.workflowId,
				},
			});
		},
		onError: () => notify.show({ title: copy.saveFailed }, "error"),
	});
	const definition = draft.data?.definition ?? null;
	const nothing = draft.isSuccess && definition === null;

	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={
					draft.isPending
						? copy.draftingSub
						: nothing
							? copy.nothingBody
							: copy.sub
				}
				title={
					draft.isPending
						? copy.draftingTitle
						: nothing
							? copy.nothingTitle
							: copy.title
				}
			/>
			{draft.isPending ? (
				<Skeleton />
			) : nothing ? null : (
				<section
					aria-label={copy.builtFrom}
					data-layout-role="onboarding-pick-card"
				>
					<span data-part="reason">{copy.builtFrom}</span>
					<div data-layout-role="onboarding-list">
						{(draft.data?.builtFrom ?? []).map((changeRequest) => (
							<div data-part="row" key={changeRequest.number}>
								<span data-part="mark">
									<ForgeMark
										className="size-3.5"
										forge={repo?.forge ?? "github"}
									/>
								</span>
								<span data-part="text">
									<span data-part="title">
										<span data-part="repo">{repo?.fullName}</span> #
										{changeRequest.number} {changeRequest.title}
									</span>
									<span data-part="meta">
										{changeRequest.author},{" "}
										{formatRelativeTime(changeRequest.openedAt)}
									</span>
								</span>
							</div>
						))}
					</div>
				</section>
			)}
			{nothing ? null : (
				<p data-layout-role="onboarding-note">
					{copy.runsOn(repo?.fullName ?? "")}
				</p>
			)}
			{nothing ? (
				<Button onAction={() => flow.advance()} size="large" variant="primary">
					{ONBOARDING_COPY.continue}
				</Button>
			) : (
				<div data-layout-role="onboarding-actions">
					<Button
						onAction={() => flow.advance()}
						size="large"
						variant="secondary"
					>
						{copy.notNow}
					</Button>
					<Button
						disabled={definition === null}
						onAction={() => save.mutate()}
						pending={save.isPending}
						size="large"
						variant="primary"
					>
						{copy.save}
					</Button>
				</div>
			)}
		</>
	);
}

export function WorkflowPreview({ flow }: StepViewProps) {
	const { org, repo, reported, draft } = useWorkflowDraft(flow);
	// Nothing to draft: the run on the newest reported change request, which
	// shows why. It crossfades in over the drafting canvas rather than cutting.
	const nothing = draft.isSuccess && draft.data.definition === null;
	const runId = nothing
		? newestReportedRunId(reported, draft.data.builtFrom)
		: null;
	return (
		<AnimatePresence initial={false} mode="popLayout">
			<motion.div
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				initial={{ opacity: 0 }}
				key={nothing ? "run" : "draft"}
				transition={UI_MOTION.column}
			>
				{nothing ? (
					<RunPreview
						latestWhenNone={false}
						org={org}
						repo={repo}
						runId={runId}
					/>
				) : (
					<WorkflowPreviewPage
						definition={draft.data?.definition ?? null}
						org={org}
						repo={repo}
					/>
				)}
			</motion.div>
		</AnimatePresence>
	);
}
