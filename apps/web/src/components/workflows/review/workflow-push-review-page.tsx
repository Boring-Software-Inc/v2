import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { WORKFLOW_PUSH_STATUS_LABELS } from "@tripwire/contracts";
import { TripwireCodeDiff } from "#/components/code";
import { ArrowLeft, Icon } from "#/components/glaze/icon";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#/components/glaze/ui/alert";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { RelativeTime } from "#/components/glaze/ui/relative-time";
import { Status, type StatusValue } from "#/components/glaze/ui/status";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	REVIEW_FRAME,
	ReviewSkeleton,
} from "#/components/workflows/review/workflow-push-review-page-skeleton";
import {
	canAccept,
	canDecide,
	type PushReviewState,
	type PushReviewWorkflow,
	pushReviewState,
} from "#/lib/workflow-push-review";
import {
	decideWorkflowPush,
	type WorkflowPushReviewData,
} from "#/lib/workflow-pushes.functions";
import {
	workflowPushQueryKeys,
	workflowPushReviewQueryOptions,
} from "#/lib/workflow-pushes.query";
import { workflowsQueryKeys } from "#/lib/workflows.query";

const routeApi = getRouteApi("/$org/$repo/workflows/review/$pushId");

const STATE_STATUS = {
	open: "waiting",
	blocked: "fail",
	stale: "warn",
	accepted: "ok",
	rejected: "idle",
	expired: "idle",
} as const satisfies Record<PushReviewState, StatusValue>;

function workflowCount(count: number): string {
	return `${count} ${count === 1 ? "workflow" : "workflows"}`;
}

export function WorkflowPushReviewPage() {
	const { org, repo, pushId } = routeApi.useParams();
	const queryClient = useQueryClient();
	const { data, isPending, isError } = useQuery(
		workflowPushReviewQueryOptions(org, repo, pushId),
	);
	const decide = useMutation({
		mutationFn: decideWorkflowPush,
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: workflowPushQueryKeys.detail(org, repo, pushId),
			});
			queryClient.invalidateQueries({ queryKey: workflowsQueryKeys.lists() });
		},
	});

	let body: React.ReactNode;
	if (isPending) {
		body = <ReviewSkeleton />;
	} else if (isError || !data) {
		body = <ReviewNotFound org={org} repo={repo} />;
	} else {
		const failure =
			decide.data && !decide.data.ok
				? decide.data.error
				: decide.error
					? decide.error.message
					: null;
		body = (
			<ReviewBody
				busy={decide.isPending}
				data={data}
				failure={failure}
				onDecide={(decision) =>
					decide.mutate({ data: { org, repo, pushId, decision } })
				}
			/>
		);
	}
	return <DashboardLayout counts={{}}>{body}</DashboardLayout>;
}

function ReviewNotFound({ org, repo }: { org: string; repo: string }) {
	return (
		<div className="grid flex-1 place-items-center p-4">
			<Empty art={<MascotArt mood="workflow-not-found" />} reason="no-results">
				<EmptyHeader>
					<EmptyTitle>Push not found</EmptyTitle>
					<EmptyDescription>
						The link is wrong, or your role cannot change workflows here.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						nativeButton={false}
						render={<Link params={{ org, repo }} to="/$org/$repo/workflows" />}
						size="sm"
						variant="secondary"
					>
						<Icon icon={ArrowLeft} />
						Back to workflows
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

interface ReviewBodyProps {
	data: WorkflowPushReviewData;
	busy: boolean;
	failure: string | null;
	onDecide: (decision: "accept" | "reject") => void;
}

function ReviewBody({ data, busy, failure, onDecide }: ReviewBodyProps) {
	const { org, repo } = routeApi.useParams();
	const state = pushReviewState(data.status, data.blocked);
	return (
		<div className={REVIEW_FRAME}>
			<header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="type-title">Review push</h1>
					<p className="type-body-sm text-text-2">
						{data.authorName} pushed {workflowCount(data.workflows.length)} to{" "}
						{data.repoFullName} <RelativeTime date={data.createdAt} />
					</p>
				</div>
				<Status className="shrink-0" status={STATE_STATUS[state]}>
					{state === "blocked"
						? "Blocked"
						: WORKFLOW_PUSH_STATUS_LABELS[data.status]}
				</Status>
			</header>
			<StateNote data={data} org={org} repo={repo} state={state} />
			{data.workflows.map((workflow) => (
				<WorkflowSection key={workflow.id} workflow={workflow} />
			))}
			{failure ? (
				<Alert status="fail">
					<AlertDescription>{failure}</AlertDescription>
				</Alert>
			) : null}
			{canDecide(state) ? (
				<footer className="sticky bottom-0 z-(--z-sticky) -mx-3 flex flex-wrap items-center justify-end gap-2 border-line-faint border-t bg-page px-3 py-3 sm:-mx-6 sm:px-6">
					<p className="me-auto type-body-sm text-text-2">
						Expires <RelativeTime date={data.expiresAt} format="long" />
					</p>
					<Button
						disabled={busy}
						onClick={() => onDecide("reject")}
						size="sm"
						variant="secondary"
					>
						Decline
					</Button>
					<Button
						disabled={busy || !canAccept(state)}
						onClick={() => onDecide("accept")}
						size="sm"
					>
						Accept changes
					</Button>
				</footer>
			) : null}
		</div>
	);
}

interface StateNoteProps {
	data: WorkflowPushReviewData;
	state: PushReviewState;
	org: string;
	repo: string;
}

function StateNote({ data, state, org, repo }: StateNoteProps) {
	switch (state) {
		case "blocked":
			return (
				<Alert announce={false} status="fail">
					<AlertTitle>A workflow that is on would break</AlertTitle>
					<AlertDescription>
						Fix tripwire.ts and push again, or decline this push.
					</AlertDescription>
				</Alert>
			);
		case "stale":
			return (
				<Alert announce={false} status="warn">
					<AlertTitle>The workflows changed after this push</AlertTitle>
					<AlertDescription>
						Run tripwire workflows diff, then push again.
					</AlertDescription>
				</Alert>
			);
		case "expired":
			return (
				<Alert announce={false}>
					<AlertTitle>This push expired</AlertTitle>
					<AlertDescription>Nothing was saved. Push again.</AlertDescription>
				</Alert>
			);
		case "rejected":
			return (
				<Alert announce={false}>
					<AlertTitle>
						Declined{data.decidedByName ? ` by ${data.decidedByName}` : ""}
					</AlertTitle>
					<AlertDescription>Nothing was saved.</AlertDescription>
				</Alert>
			);
		case "accepted":
			return (
				<Alert announce={false} status="ok">
					<AlertTitle>
						Accepted{data.decidedByName ? ` by ${data.decidedByName}` : ""}
					</AlertTitle>
					<AlertDescription>
						<ul className="flex flex-col gap-1">
							{data.outcomes.map((outcome) => (
								<li key={outcome.id}>
									<Link
										className="underline underline-offset-2"
										params={{ org, repo, workflowId: outcome.workflowId }}
										to="/$org/$repo/workflows/$workflowId"
									>
										{outcome.name}
									</Link>{" "}
									{outcome.outcome === "created" ? "created, off" : "updated"}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			);
		default:
			return null;
	}
}

function WorkflowSection({ workflow }: { workflow: PushReviewWorkflow }) {
	return (
		<section
			aria-labelledby={`push-${workflow.id}`}
			className="flex min-w-0 flex-col gap-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="type-heading-sm" id={`push-${workflow.id}`}>
					{workflow.name}
				</h2>
				<Badge variant={workflow.change === "new" ? "ok" : "neutral"}>
					{workflow.change === "new" ? "New" : "Changed"}
				</Badge>
				{workflow.enabled ? <Badge variant="outline">On</Badge> : null}
				{workflow.stale ? (
					<Badge variant="warn">Changed since push</Badge>
				) : null}
			</div>
			<IssueList workflow={workflow} />
			{workflow.code.kind === "code" ? (
				<TripwireCodeDiff
					after={workflow.code.after}
					before={workflow.code.before}
					name="tripwire.ts"
				/>
			) : (
				<p className="type-body-sm text-text-2">{workflow.code.reason}</p>
			)}
		</section>
	);
}

function IssueList({ workflow }: { workflow: PushReviewWorkflow }) {
	const rows: { key: string; status: StatusValue; text: string }[] = [
		...workflow.blocking.map((text) => ({
			key: `b:${text}`,
			status: "fail" as const,
			text,
		})),
		...workflow.errors.map((text) => ({
			key: `e:${text}`,
			status: "fail" as const,
			text,
		})),
		...workflow.warnings.map((text) => ({
			key: `w:${text}`,
			status: "warn" as const,
			text,
		})),
	];
	if (rows.length === 0) {
		return null;
	}
	return (
		<ul className="flex flex-col gap-1">
			{rows.map((row) => (
				<li key={row.key}>
					<Status status={row.status}>{row.text}</Status>
				</li>
			))}
		</ul>
	);
}
