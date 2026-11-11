import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ContributionAppealStatus } from "@tripwire/contracts";
import { useState } from "react";
import { AppealPageSkeleton } from "#/components/appeals/appeal-page-skeleton";
import { AppealSignIn } from "#/components/appeals/appeal-sign-in";
import { ContributionAppealLayout } from "#/components/layouts/contribution-appeal-layout";
import { FormActions, FormSection } from "#/components/layouts/section";
import { Button } from "#/design-system/ui/button";
import { Field, FieldLabel } from "#/design-system/ui/field";
import { Textarea } from "#/design-system/ui/textarea";
import {
	Caption,
	PageTitle,
	SupportingText,
} from "#/design-system/ui/typography";
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
					<Button className="self-start" onClick={() => void query.refetch()}>
						Try again
					</Button>
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
					<Button
						className="self-start"
						nativeButton={false}
						render={
							<Link
								params={{
									target: appeal.pendingRunId ?? appeal.pendingOrgSlug ?? "",
								}}
								to="/appeals/$target"
							/>
						}
						variant="secondary"
					>
						View open appeal
					</Button>
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
						<FieldLabel htmlFor="appeal-reason" id="appeal-reason-label">
							Why should a maintainer review this decision?
						</FieldLabel>
						<Textarea
							aria-labelledby="appeal-reason-label"
							id="appeal-reason"
							maxLength={2000}
							onChange={(event) => setReason(event.target.value)}
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
