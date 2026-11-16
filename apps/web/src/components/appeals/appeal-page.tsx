import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContributionAppealStatus } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Field, FieldLabel, Textarea } from "@tripwire/ui/field";
import { Caption, PageTitle, SupportingText } from "@tripwire/ui/typography";
import { useState } from "react";
import { AppealPageSkeleton } from "#/components/appeals/appeal-page-skeleton";
import { AppealSignIn } from "#/components/appeals/appeal-sign-in";
import { ContributionAppealLayout } from "#/components/layouts/contribution-appeal-layout";
import { FormActions, FormSection } from "#/components/layouts/section";
import { submitContributionAppeal } from "#/lib/contribution-appeals.functions";
import { contributionAppealOptions } from "#/lib/contribution-appeals.query";

const statusCopy = {
	pending: "Your appeal is waiting for a maintainer.",
	"approve-once": "A maintainer approved this contribution.",
	"approve-author":
		"A maintainer approved this contribution and added your account to the allowlist.",
	deny: "A maintainer denied your appeal.",
} satisfies Record<ContributionAppealStatus, string>;

export function AppealPage({ runId }: { runId: string }) {
	const client = useQueryClient();
	const query = useQuery(contributionAppealOptions(runId));
	const [reason, setReason] = useState("");
	const submit = useMutation({
		mutationFn: async () => {
			const result = await submitContributionAppeal({
				data: { runId, reason },
			});
			if (!result) throw new Error("Appeal unavailable");
			return result;
		},
		onSuccess: (appeal) => {
			client.setQueryData(contributionAppealOptions(runId).queryKey, {
				state: "eligible",
				...appeal,
			});
			void client.invalidateQueries({
				queryKey: ["contribution-appeal-portal"],
			});
		},
	});

	if (query.isPending) return <AppealPageSkeleton />;

	const appeal = query.data;
	return (
		<ContributionAppealLayout>
			<PageTitle>Appeal a moderation decision</PageTitle>
			{query.isError ? (
				<>
					<SupportingText>Tripwire couldn't load this appeal.</SupportingText>
					<div className="self-start">
						<Button onAction={() => void query.refetch()}>Try again</Button>
					</div>
				</>
			) : appeal?.state === "signed-out" ? (
				<AppealSignIn returnTo={`/appeals/${runId}`} />
			) : appeal?.state !== "eligible" ? (
				<SupportingText>
					This appeal is unavailable for your GitHub account.
				</SupportingText>
			) : appeal.status ? (
				<output>
					<SupportingText>{statusCopy[appeal.status]}</SupportingText>
					{appeal.appealId && <Caption>Case {appeal.appealId}</Caption>}
				</output>
			) : appeal.pendingRunId || appeal.pendingOrgSlug ? (
				<>
					<SupportingText>
						You can submit another appeal after a maintainer resolves your open
						case.
					</SupportingText>
					<div className="self-start">
						<Button
							href={`/appeals/${appeal.pendingRunId ?? appeal.pendingOrgSlug ?? ""}`}
							variant="secondary"
						>
							View open appeal
						</Button>
					</div>
				</>
			) : (
				<FormSection
					data-appeal-form=""
					onSubmit={(event) => {
						event.preventDefault();
						if (reason.trim() && !submit.isPending) submit.mutate();
					}}
				>
					<Field>
						<FieldLabel>
							Why should a maintainer review this decision?
						</FieldLabel>
						<Textarea
							ariaLabel="Why should a maintainer review this decision?"
							id="appeal-reason"
							maxLength={2000}
							onValueChange={setReason}
							required
							rows={5}
							value={reason}
						/>
					</Field>

					{submit.isError ? (
						<SupportingText role="alert">
							Tripwire couldn't submit the appeal. Try again.
						</SupportingText>
					) : null}
					<FormActions
						primary={
							<Button
								disabled={!reason.trim()}
								pending={submit.isPending}
								type="submit"
							>
								Submit appeal
							</Button>
						}
					/>
				</FormSection>
			)}
		</ContributionAppealLayout>
	);
}
