import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ContributionAppealDecision } from "@tripwire/contracts";
import { Button } from "#/design-system/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "#/design-system/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import { toast } from "#/design-system/ui/toast";
import { SupportingText } from "#/design-system/ui/typography";
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
			toast(
				result ? "Appeal resolved" : "This appeal has already been resolved",
			);
		},
		onError: () =>
			toast.fail("Tripwire couldn't resolve the appeal. Try again."),
	});

	const resolve = useMutation({
		mutationFn: (appealId: string) =>
			resolveOrganizationAppeal({ data: { org, appealId } }),
		onSuccess: async (result) => {
			await client.invalidateQueries({
				queryKey: ["contribution-appeals", org],
			});
			toast(
				result ? "Appeal resolved" : "This appeal has already been resolved",
			);
		},
		onError: () =>
			toast.fail("Tripwire couldn't resolve the appeal. Try again."),
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
						<Button
							nativeButton={false}
							render={<Link params={{ target: org }} to="/appeals/$target" />}
							size="sm"
							variant="primary"
						>
							Appeal portal
						</Button>
					</CardAction>
				</CardHeader>
				{query.isError ? (
					<CardContent>
						<SupportingText>Tripwire couldn't load appeals.</SupportingText>
						<Button
							onClick={() => void query.refetch()}
							size="sm"
							variant="ghost"
						>
							Try again
						</Button>
					</CardContent>
				) : !query.data?.contributions.length &&
					!query.data?.organizationAppeals.length ? (
					<CardContent>
						<Empty size="sm" variant="plain">
							<EmptyHeader>
								<EmptyTitle>No pending appeals</EmptyTitle>
								<EmptyDescription>
									New contributor appeals will appear here for review.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
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
									<CardFooter className="flex-wrap">
										{decisions
											.filter(
												({ value }) =>
													value !== "approve-author" || canManageRules,
											)
											.map(({ value, label }) => (
												<Button
													disabled={decide.isPending}
													key={value}
													onClick={() =>
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
													size="sm"
													variant="secondary"
												>
													{label}
												</Button>
											))}
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
										<Button
											disabled={resolve.isPending}
											onClick={() => resolve.mutate(appeal.id)}
											pending={
												resolve.isPending && resolve.variables === appeal.id
											}
											size="sm"
											variant="secondary"
										>
											Mark resolved
										</Button>
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
