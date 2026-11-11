import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ContributionAppealDecision } from "@tripwire/contracts";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import { Button } from "#/design-system/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "#/design-system/ui/card";
import { toast } from "#/design-system/ui/toast";
import { SupportingText } from "#/design-system/ui/typography";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { decideContributionAppeal } from "#/lib/contribution-appeals.functions";
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
	const query = useQuery(options);
	const canDecide = useOrgPermission(org, "moderation:manage");
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

	if (query.isPending || (!query.isError && !query.data?.length)) return null;

	return (
		<Section id="contribution-appeals">
			<SectionHeader title="Appeals" />
			{query.isError ? (
				<SectionBody>
					<SupportingText>Tripwire couldn't load appeals.</SupportingText>
					<Button
						onClick={() => void query.refetch()}
						size="sm"
						variant="ghost"
					>
						Try again
					</Button>
				</SectionBody>
			) : (
				<SectionBody>
					{query.data?.map((appeal) => (
						<Card key={appeal.id}>
							<CardHeader>
								<CardTitle>
									<Link
										className="hover:underline"
										params={{ runId: appeal.runId }}
										to="/runs/$runId"
									>
										{appeal.subjectKind === "issue" ? "Issue" : "Pull request"}{" "}
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
				</SectionBody>
			)}
		</Section>
	);
}
