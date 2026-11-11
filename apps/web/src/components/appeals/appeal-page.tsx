import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ContributionAppealStatus } from "@tripwire/contracts";
import { useState } from "react";
import { AppealPageSkeleton } from "#/components/appeals/appeal-page-skeleton";
import { ContributionAppealLayout } from "#/components/layouts/contribution-appeal-layout";
import { FormSection } from "#/components/layouts/section";
import { Button } from "#/design-system/ui/button";
import { Field, FieldLabel } from "#/design-system/ui/field";
import { Textarea } from "#/design-system/ui/textarea";
import { PageTitle, SupportingText } from "#/design-system/ui/typography";
import { authClient } from "#/lib/auth-client";
import { submitContributionAppeal } from "#/lib/contribution-appeals.functions";
import { contributionAppealOptions } from "#/lib/contribution-appeals.query";

const route = getRouteApi("/appeals/$runId");

const statusCopy = {
	pending: "Your appeal is waiting for a maintainer.",
	"approve-once": "A maintainer approved this contribution.",
	"approve-author":
		"A maintainer approved this contribution and added your account to the allowlist.",
	deny: "A maintainer denied your appeal.",
} satisfies Record<ContributionAppealStatus, string>;

export function AppealPage() {
	const { runId } = route.useParams();
	const client = useQueryClient();
	const query = useQuery(contributionAppealOptions(runId));
	const [reason, setReason] = useState("");
	const signIn = useMutation({
		mutationFn: async () => {
			const result = await authClient.signIn.social({
				provider: "github",
				callbackURL: `/appeals/${runId}`,
			});
			if (result.error) throw new Error("GitHub sign-in failed");
		},
	});
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
				<>
					<SupportingText>
						Sign in with the GitHub account that opened the contribution.
					</SupportingText>
					<Button
						className="self-start"
						onClick={() => signIn.mutate()}
						pending={signIn.isPending}
					>
						Sign in with GitHub
					</Button>
					{signIn.isError ? (
						<SupportingText role="alert">
							GitHub sign-in failed. Try again.
						</SupportingText>
					) : null}
				</>
			) : appeal?.state !== "eligible" ? (
				<SupportingText>
					This appeal is unavailable for your GitHub account.
				</SupportingText>
			) : appeal.status ? (
				<output>
					<SupportingText as="span">{statusCopy[appeal.status]}</SupportingText>
				</output>
			) : (
				<FormSection
					onSubmit={(event) => {
						event.preventDefault();
						if (reason.trim() && !submit.isPending) submit.mutate();
					}}
				>
					<Field>
						<FieldLabel htmlFor="appeal-reason">
							Why should a maintainer review this decision?
						</FieldLabel>
						<Textarea
							id="appeal-reason"
							maxLength={2000}
							onChange={(event) => setReason(event.target.value)}
							required
							rows={5}
							value={reason}
						/>
					</Field>
					<Button
						className="self-start"
						disabled={!reason.trim()}
						pending={submit.isPending}
						type="submit"
					>
						Submit appeal
					</Button>
					{submit.isError ? (
						<SupportingText role="alert">
							Tripwire couldn't submit the appeal. Try again.
						</SupportingText>
					) : null}
				</FormSection>
			)}
		</ContributionAppealLayout>
	);
}
