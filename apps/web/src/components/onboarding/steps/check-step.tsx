import { useQuery } from "@tanstack/react-query";
import {
	ONBOARDING_MAX_REPORTED,
	RUN_RESULT_LABELS,
	runResult,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Input } from "@tripwire/ui/field";
import { Icon, Pending, Search } from "@tripwire/ui/icon";
import { Skeleton } from "@tripwire/ui/skeleton";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import {
	type ReportRun,
	useOnboardingDraft,
} from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";
import { newestReportedRunId } from "#/components/onboarding/preview/reported-run";
import { RunPreview } from "#/components/onboarding/preview/run-preview";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { rerunChangeRequest } from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";
import {
	onboardingChangeRequestsQueryOptions,
	onboardingReportedQueryOptions,
} from "#/lib/onboarding-flow.query";
import { runQueryOptions } from "#/lib/runs.query";

const copy = ONBOARDING_COPY.check;

/**
 * Step 6: point at change requests that should not have got through. Each one
 * is re-run with the rules just installed, in the background; the drafted
 * workflow is built from whichever rules did not pass.
 */
export function CheckStep({ flow }: StepViewProps) {
	const [draft, , updateWith] = useOnboardingDraft();
	const [query, setQuery] = useState("");
	const debounced = useDebouncedValue(query.trim(), 200);
	const org = flow.state.orgSlug ?? flow.state.personalOrgSlug ?? "";
	const repo = flow.state.repo;
	const list = useQuery({
		...onboardingChangeRequestsQueryOptions(org, repo?.id ?? "", debounced),
		enabled: repo !== null,
	});
	const full = draft.reported.length >= ONBOARDING_MAX_REPORTED;

	const report = async (number: number) => {
		if (!repo || draft.reported.includes(number) || full) {
			return;
		}
		updateWith((current) => ({
			reported: [...current.reported, number],
			runs: { ...current.runs, [number]: { status: "starting" } },
		}));
		// Saved as it is added, so a reload keeps the reports.
		flow.save({ answers: { reported: [...draft.reported, number] } });
		const result: ReportRun = await rerunChangeRequest({
			data: { org, repo: repo.name, number },
		})
			.then(
				(response): ReportRun =>
					response.status === "queued"
						? { status: "queued", runId: response.runId }
						: response.status === "cooldown"
							? { status: "cooldown" }
							: { status: "error" },
			)
			.catch((): ReportRun => ({ status: "error" }));
		updateWith((current) => ({ runs: { ...current.runs, [number]: result } }));
	};

	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={copy.sub}
				title={copy.title}
			/>
			<div data-layout-role="onboarding-list">
				<div data-part="search">
					<Input
						ariaLabel={copy.searchPlaceholder}
						leadingIcon={<Icon icon={Search} />}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={copy.searchPlaceholder}
						value={query}
					/>
				</div>
				{list.isPending ? (
					<Skeleton />
				) : (list.data ?? []).length === 0 ? (
					<div data-part="empty">
						{debounced ? (
							<span data-part="body">{copy.searchEmpty(debounced)}</span>
						) : (
							<>
								<span data-part="title">{copy.noneTitle}</span>
								<span data-part="body">{copy.noneBody}</span>
							</>
						)}
					</div>
				) : (
					(list.data ?? []).map((changeRequest) => {
						// After a reload the draft has no run for a saved report, so the
						// newest one on the change request stands in.
						const run: ReportRun | undefined =
							draft.runs[changeRequest.number] ??
							(draft.reported.includes(changeRequest.number) &&
							changeRequest.latestRunId
								? { status: "queued", runId: changeRequest.latestRunId }
								: undefined);
						const closed = changeRequest.closedAt !== null;
						return (
							<div
								data-closed={closed ? "true" : "false"}
								data-part="row"
								key={changeRequest.number}
							>
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
										{changeRequest.author}, {closed ? "closed" : "opened"}{" "}
										{formatRelativeTime(
											changeRequest.closedAt ?? changeRequest.openedAt,
										)}
									</span>
								</span>
								{run ? (
									<ReportStatus run={run} />
								) : (
									<Button
										disabled={full}
										onAction={() => report(changeRequest.number)}
										size="small"
										variant="secondary"
									>
										{copy.add}
									</Button>
								)}
							</div>
						);
					})
				)}
			</div>
			<p data-layout-role="onboarding-note">{copy.background}</p>
			<div data-layout-role="onboarding-actions">
				<Button
					onAction={() => flow.advance({ answers: { reported: [] } })}
					size="large"
					variant="secondary"
				>
					{copy.skipForNow}
				</Button>
				<Button
					disabled={draft.reported.length === 0}
					onAction={() =>
						flow.advance({ answers: { reported: draft.reported } })
					}
					size="large"
					variant="primary"
				>
					{ONBOARDING_COPY.continue}
				</Button>
			</div>
		</>
	);
}

/** Where a reported change request's re-run is, read live from the run. */
function ReportStatus({ run }: { run: ReportRun }) {
	const live = useQuery({
		...runQueryOptions(run.status === "queued" ? run.runId : ""),
		enabled: run.status === "queued",
	});
	if (run.status === "cooldown") {
		return <span data-part="status">{copy.cooldown}</span>;
	}
	if (run.status === "error") {
		return (
			<span data-part="status" data-tone="fail">
				{copy.error}
			</span>
		);
	}
	const status = live.data?.status;
	if (run.status === "starting" || !status || status === "queued") {
		return <span data-part="status">{copy.queued}</span>;
	}
	if (status === "running") {
		return (
			<span data-part="status" data-tone="active">
				<Icon icon={Pending} motion="spin" size={12} />
				{copy.running}
			</span>
		);
	}
	const failed = (live.data?.steps ?? []).filter(
		(step) => step.nodeKind === "rule" && step.status === "fail",
	).length;
	if (failed > 0) {
		return (
			<span data-part="status" data-tone="fail">
				{copy.failed(failed)}
			</span>
		);
	}
	// Nothing failed, but a run can still end short of a pass, such as when
	// rules were skipped and it went to human review: say what the run says.
	const result = live.data
		? runResult({ ...live.data, bearsVerdict: true })
		: null;
	return result === null || result === "pass" ? (
		<span data-part="status" data-tone="ok">
			{copy.passed}
		</span>
	) : (
		<span data-part="status">{RUN_RESULT_LABELS[result]}</span>
	);
}

/**
 * The run page for the newest reported change request, filling in live: the
 * re-run started here, or after a reload the newest run stored on it. Before
 * anything is reported it shows the repo's latest run.
 */
export function CheckPreview({ flow }: StepViewProps) {
	const [draft] = useOnboardingDraft();
	const org = flow.state.orgSlug ?? flow.state.personalOrgSlug ?? "";
	const repo = flow.state.repo;
	const stored = useQuery({
		...onboardingReportedQueryOptions(org, repo?.id ?? "", draft.reported),
		enabled: repo !== null && draft.reported.length > 0,
	});
	const runId = newestReportedRunId(draft.reported, stored.data, draft.runs);
	return (
		<RunPreview
			expecting={draft.reported.length > 0 && stored.isPending}
			latestWhenNone={draft.reported.length === 0}
			org={org}
			repo={repo}
			runId={runId}
		/>
	);
}
