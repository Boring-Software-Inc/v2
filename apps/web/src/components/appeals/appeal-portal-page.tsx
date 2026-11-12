import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	type ContributionAppealStatus,
	type OrganizationAppealType,
	organizationAppealTypeSchema,
} from "@tripwire/contracts";
import { useState } from "react";
import { AppealAdminPortal } from "#/components/appeals/appeal-admin-portal";
import { AppealPageSkeleton } from "#/components/appeals/appeal-page-skeleton";
import { AppealSignIn } from "#/components/appeals/appeal-sign-in";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import { ContributionAppealLayout } from "#/components/layouts/contribution-appeal-layout";
import { FormActions } from "#/components/layouts/section";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { External, Icon } from "#/design-system/icon";
import { Button, buttonVariants } from "#/design-system/ui/button";
import { Card, CardContent } from "#/design-system/ui/card";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/design-system/ui/dialog";
import { Field, FieldLabel } from "#/design-system/ui/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/design-system/ui/item";
import { NativeSelect } from "#/design-system/ui/select";
import { Textarea } from "#/design-system/ui/textarea";
import {
	PageTitle,
	SectionHeading,
	SupportingText,
} from "#/design-system/ui/typography";
import { useSignOut } from "#/hooks/use-sign-out";
import {
	type getContributionAppealPortal,
	submitOrganizationAppeal,
} from "#/lib/contribution-appeals.functions";
import { contributionAppealPortalOptions } from "#/lib/contribution-appeals.query";

const caseLabels = {
	pending: "Awaiting review",
	"approve-once": "Approved",
	"approve-author": "Approved",
	deny: "Denied",
} satisfies Record<ContributionAppealStatus, string>;

type PortalResult = Awaited<ReturnType<typeof getContributionAppealPortal>>;
type Decision = Extract<PortalResult, { state: "signed-in" }>["cases"][number];

function contributionLabel(kind: Decision["subjectKind"]) {
	return kind === "issue" ? "Issue" : "Pull request";
}

function AppealDecision({
	decision,
	label,
}: {
	decision: Decision;
	label: string;
}) {
	const title = `${contributionLabel(decision.subjectKind)} #${decision.subjectNumber}`;
	return (
		<Item>
			<ItemContent>
				<ItemTitle>{title}</ItemTitle>
				<ItemDescription>{decision.repoName}</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button
					aria-label={`${label} ${title} in ${decision.repoName}`}
					nativeButton={false}
					render={
						<Link params={{ target: decision.runId }} to="/appeals/$target" />
					}
					size="sm"
					variant="secondary"
				>
					{label}
				</Button>
			</ItemActions>
		</Item>
	);
}

function NewAppeal({ org, disabled }: { org: string; disabled: boolean }) {
	const client = useQueryClient();
	const [open, setOpen] = useState(false);
	const [type, setType] = useState<OrganizationAppealType | "">("");
	const [reason, setReason] = useState("");
	const submit = useMutation({
		mutationFn: (selected: OrganizationAppealType) =>
			submitOrganizationAppeal({ data: { org, type: selected, reason } }),
		onSuccess: async (result) => {
			if (result.status !== "unavailable") {
				await client.invalidateQueries({
					queryKey: contributionAppealPortalOptions(org).queryKey,
				});
				setOpen(false);
			}
		},
	});
	const unavailable = submit.data?.status === "unavailable";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (submit.isPending) return;
				setOpen(next);
				if (next) {
					setType("");
					setReason("");
					submit.reset();
				}
			}}
		>
			<DialogTrigger
				render={<Button disabled={disabled} className="shrink-0" />}
			>
				New appeal
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New appeal</DialogTitle>
					<DialogDescription>
						Send an appeal to this organization’s moderators.
					</DialogDescription>
				</DialogHeader>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						if (type && reason.trim() && !submit.isPending) submit.mutate(type);
					}}
				>
					<DialogBody>
						<Field>
							<FieldLabel htmlFor="organization-appeal-type">
								Appeal type
							</FieldLabel>
							<NativeSelect
								id="organization-appeal-type"
								value={type}
								required
								onChange={(event) => {
									const selected = organizationAppealTypeSchema.safeParse(
										event.currentTarget.value,
									);
									setType(selected.success ? selected.data : "");
								}}
							>
								<option value="">Select a type</option>
								<option value="issue">Issue moderation</option>
								<option value="pull-request">Pull request moderation</option>
								<option value="other">Other</option>
							</NativeSelect>
						</Field>
						<Field>
							<FieldLabel htmlFor="organization-appeal-reason">
								Why are you appealing?
							</FieldLabel>
							<Textarea
								id="organization-appeal-reason"
								maxLength={2000}
								onChange={(event) => setReason(event.currentTarget.value)}
								required
								rows={5}
								value={reason}
							/>
						</Field>
						{unavailable || submit.isError ? (
							<SupportingText role="alert">
								{unavailable
									? "Connect a GitHub account before submitting an appeal."
									: "Tripwire couldn’t submit the appeal. Try again."}
							</SupportingText>
						) : null}
						<FormActions
							primary={
								<Button
									type="submit"
									pending={submit.isPending}
									disabled={!type || !reason.trim()}
								>
									Submit appeal
								</Button>
							}
						/>
					</DialogBody>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function AppealPortalPage({
	org,
	preview = false,
}: {
	org: string;
	preview?: boolean;
}) {
	const returnTo = `/appeals/${encodeURIComponent(org)}`;
	const previewUrl = `${returnTo}?preview=public`;
	const signOut = useSignOut(returnTo);
	const [signOutOpen, setSignOutOpen] = useState(false);
	const query = useQuery(contributionAppealPortalOptions(org));
	if (query.isPending) return <AppealPageSkeleton />;
	const portal = query.data;
	const cases =
		portal?.state === "signed-in"
			? portal.cases.filter((entry) => entry.status !== null)
			: [];

	const pending =
		portal?.state === "signed-in"
			? (portal.pendingRunId ?? portal.pendingOrgSlug)
			: null;

	if (portal?.state === "admin" && !preview) {
		return (
			<ContributionAppealLayout
				wide
				headerAction={
					<div data-layout-role="appeal-header-actions">
						<a
							className={buttonVariants({ size: "sm", variant: "secondary" })}
							href={previewUrl}
							rel="noreferrer"
							target="_blank"
						>
							Preview portal
							<Icon icon={External} size={12} />
						</a>
						<Button
							nativeButton={false}
							render={<Link params={{ org }} to="/$org/home" />}
							size="sm"
							variant="secondary"
						>
							Dashboard
						</Button>
						<Button
							onClick={() => setSignOutOpen(true)}
							size="sm"
							variant="ghost"
						>
							Sign out of Tripwire
						</Button>
					</div>
				}
			>
				<ConfirmDestructiveDialog
					actionLabel="Sign out of Tripwire"
					description="This signs you out of Tripwire on this device, including the dashboard and appeal portal."
					onConfirm={() => signOut.mutateAsync()}
					onOpenChange={setSignOutOpen}
					open={signOutOpen}
					pendingLabel="Signing out"
					title="Sign out of Tripwire?"
				/>
				<AppealAdminPortal
					avatarHue={portal.avatarHue}
					canManage={portal.canManage}
					inbox={portal.inbox}
					org={org}
					orgName={portal.orgName}
					settings={portal.settings}
				/>
			</ContributionAppealLayout>
		);
	}

	return (
		<ContributionAppealLayout
			headerAction={
				portal?.state === "signed-in" &&
				!preview && (
					<Button
						onClick={() => setSignOutOpen(true)}
						size="sm"
						variant="ghost"
					>
						Sign out of Tripwire
					</Button>
				)
			}
		>
			<ConfirmDestructiveDialog
				actionLabel="Sign out of Tripwire"
				description="This signs you out of Tripwire on this device, including the dashboard and appeal portal."
				onConfirm={() => signOut.mutateAsync()}
				onOpenChange={setSignOutOpen}
				open={signOutOpen}
				pendingLabel="Signing out"
				title="Sign out of Tripwire?"
			/>
			<div data-layout-role="appeal-portal-hero">
				<div data-layout-role="appeal-portal-hero-row">
					<div data-layout-role="appeal-portal-identity">
						<OrgAvatar
							decorative={false}
							hue={portal?.avatarHue}
							name={portal?.orgName ?? org}
							size="lg"
						/>
						<div data-layout-role="appeal-portal-identity-copy">
							<SupportingText>{portal?.orgName ?? org}</SupportingText>
							<PageTitle>{portal?.settings.title ?? "Appeals"}</PageTitle>
						</div>
					</div>
					{portal?.state === "signed-in" && !preview && !query.isError && (
						<NewAppeal org={org} disabled={Boolean(pending)} />
					)}
				</div>
				<SupportingText>
					{portal?.settings.description ??
						"Ask the organization to review a moderation decision."}
				</SupportingText>
			</div>
			{query.isError ? (
				<>
					<SupportingText>
						Tripwire couldn’t load your decisions.
					</SupportingText>
					<Button className="self-start" onClick={() => void query.refetch()}>
						Try again
					</Button>
				</>
			) : portal?.state === "signed-out" || preview ? (
				<Card>
					<CardContent>
						<SectionHeading>Sign in to continue</SectionHeading>
						<AppealSignIn organization returnTo={returnTo} />
					</CardContent>
				</Card>
			) : portal?.state === "signed-in" ? (
				<>
					{pending && (
						<SupportingText>
							You already have an appeal awaiting review.{" "}
							{pending !== org && (
								<Link
									className="underline"
									params={{ target: pending }}
									to="/appeals/$target"
								>
									View open appeal
								</Link>
							)}
						</SupportingText>
					)}
					{(cases.length > 0 || portal.requests.length > 0) && (
						<Card>
							<CardContent flush>
								<ItemGroup aria-label="Your appeals">
									{portal.requests.map((request) => (
										<Item key={request.id}>
											<ItemContent>
												<ItemTitle>Organization appeal</ItemTitle>
												<ItemDescription className="break-all">
													Case {request.id}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<SupportingText>
													{request.resolvedAt ? "Resolved" : "Awaiting review"}
												</SupportingText>
											</ItemActions>
										</Item>
									))}
									{cases.map(
										(entry) =>
											entry.status && (
												<AppealDecision
													key={entry.runId}
													decision={entry}
													label={caseLabels[entry.status]}
												/>
											),
									)}
								</ItemGroup>
							</CardContent>
						</Card>
					)}
					{cases.length === 0 && portal.requests.length === 0 ? (
						<Card>
							<CardContent>
								<SectionHeading>No appeals yet</SectionHeading>
								<SupportingText>
									You can submit an appeal even when a moderation event is
									missing or was recorded incorrectly.
								</SupportingText>
							</CardContent>
						</Card>
					) : null}
				</>
			) : null}
		</ContributionAppealLayout>
	);
}
