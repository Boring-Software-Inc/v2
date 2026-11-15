import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ContributionAppealDecision } from "@tripwire/contracts";
import { AgentBoundary } from "@tripwire/ui/agent-policy";
import { Button } from "@tripwire/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@tripwire/ui/card";
import { notify } from "@tripwire/ui/toast";
import { SupportingText } from "@tripwire/ui/typography";
import {
	EmptyState,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { useOrgPermission } from "#/hooks/use-org-permission";
import {
	decideContributionAppeal,
	resolveOrganizationAppeal,
} from "#/lib/contribution-appeals.functions";
import { contributionAppealsOptions } from "#/lib/contribution-appeals.query";

const decisions: { value: ContributionAppealDecision; label: string }[] = [
	{ value: "approve-once", label: "Approve once" },
	{ value: "approve-author", label: "Approve and add to allowlist" },
	{ value: "deny", label: "Deny" },
];

export function ContributionAppealsQueue({
	org,
	repo,
}: {
	org: string;
	repo: string;
}) {
	const client = useQueryClient();
	const options = contributionAppealsOptions(org, repo);
	const canRead = useOrgPermission(org, "appeals:read");
	const query = useQuery({ ...options, enabled: canRead });
	const canDecide = useOrgPermission(org, "appeals:manage");
	const canManageRules = useOrgPermission(org, "rules:manage");
	const decide = useMutation({
		mutationFn: ({
			appealId,
			decision,
		}: {
			appealId: string;
			decision: ContributionAppealDecision;
		}) => decideContributionAppeal({ data: { org, repo, appealId, decision } }),
		onSuccess: async (result) => {
			await client.invalidateQueries({ queryKey: options.queryKey });
			notify.show({
				title: result
					? "Appeal resolved"
					: "This appeal has already been resolved",
			});
		},
		onError: () =>
			notify.show(
				{ title: "Tripwire couldn't resolve the appeal. Try again." },
				"error",
			),
	});

	const resolve = useMutation({
		mutationFn: (appealId: string) =>
			resolveOrganizationAppeal({ data: { org, appealId } }),
		onSuccess: async (result) => {
			await client.invalidateQueries({
				queryKey: ["contribution-appeals", org],
			});
			notify.show({
				title: result
					? "Appeal resolved"
					: "This appeal has already been resolved",
			});
		},
		onError: () =>
			notify.show(
				{ title: "Tripwire couldn't resolve the appeal. Try again." },
				"error",
			),
	});

	if (!canRead || query.isPending) return null;

	return (
		<section
			aria-labelledby="contribution-appeals-heading"
			id="contribution-appeals"
		>
			<Card>
				<CardHeader>
					<CardTitle>
						<h2 id="contribution-appeals-heading">Appeals</h2>
					</CardTitle>
					<CardAction>
						<Button href={`/appeals/${org}`} size="small" variant="primary">
							Appeal portal
						</Button>
					</CardAction>
				</CardHeader>
				{query.isError ? (
					<CardContent>
						<SupportingText>Tripwire couldn't load appeals.</SupportingText>
						<Button
							onAction={() => void query.refetch()}
							size="small"
							variant="ghost"
						>
							Try again
						</Button>
					</CardContent>
				) : !query.data?.contributions.length &&
					!query.data?.organizationAppeals.length ? (
					<CardContent>
						<EmptyState size="sm" variant="plain">
							<EmptyStateHeader>
								<EmptyStateTitle>No pending appeals</EmptyStateTitle>
								<EmptyStateDescription>
									New contributor appeals will appear here for review.
								</EmptyStateDescription>
							</EmptyStateHeader>
						</EmptyState>
					</CardContent>
				) : (
					<CardContent>
						{query.data?.contributions.map((appeal) => (
							<Card key={appeal.id}>
								<CardHeader>
									<CardTitle>
										<Link
											className="hover:underline"
											params={{ runId: appeal.runId }}
											search={{ from: "review" }}
											to="/runs/$runId"
										>
											{appeal.subjectKind === "issue"
												? "Issue"
												: "Pull request"}{" "}
											#{appeal.subjectNumber}
										</Link>
									</CardTitle>
									<CardDescription>@{appeal.login}</CardDescription>
								</CardHeader>
								<CardContent>
									<p className="whitespace-pre-wrap break-words">
										{appeal.reason}
									</p>
								</CardContent>
								{canDecide ? (
									<CardFooter wrap>
										<AgentBoundary visibility="hidden">
											{decisions
												.filter(
													({ value }) =>
														value !== "approve-author" || canManageRules,
												)
												.map(({ value, label }) => (
													<Button
														disabled={decide.isPending}
														key={value}
														onAction={() =>
															decide.mutate({
																appealId: appeal.id,
																decision: value,
															})
														}
														pending={
															decide.isPending &&
															decide.variables?.appealId === appeal.id &&
															decide.variables.decision === value
														}
														size="small"
														variant="secondary"
													>
														{label}
													</Button>
												))}
										</AgentBoundary>
									</CardFooter>
								) : null}
							</Card>
						))}
						{query.data?.organizationAppeals.map((appeal) => (
							<Card key={appeal.id}>
								<CardHeader>
									<CardTitle>Organization appeal</CardTitle>
									<CardDescription>
										{appeal.type === "issue"
											? "Issue moderation"
											: appeal.type === "pull-request"
												? "Pull request moderation"
												: "Other"}
										{" · "}GitHub account {appeal.accountId}
									</CardDescription>
								</CardHeader>
								<CardContent>
									<p className="whitespace-pre-wrap break-words">
										{appeal.reason}
									</p>
									<SupportingText>Case {appeal.id}</SupportingText>
								</CardContent>
								{canDecide && (
									<CardFooter>
										<AgentBoundary visibility="hidden">
											<Button
												disabled={resolve.isPending}
												onAction={() => resolve.mutate(appeal.id)}
												pending={
													resolve.isPending && resolve.variables === appeal.id
												}
												size="small"
												variant="secondary"
											>
												Mark resolved
											</Button>
										</AgentBoundary>
									</CardFooter>
								)}
							</Card>
						))}
					</CardContent>
				)}
			</Card>
		</section>
	);
}
