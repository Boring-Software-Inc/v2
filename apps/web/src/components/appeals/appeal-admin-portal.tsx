import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
	AppealPortalSettings,
	ContributionAppealDecision,
} from "@tripwire/contracts";
import { useState } from "react";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { Button } from "#/design-system/ui/button";
import {
	Card,
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
import { Field, FieldLabel } from "#/design-system/ui/field";
import { Input } from "#/design-system/ui/input";
import { Textarea } from "#/design-system/ui/textarea";
import { toast } from "#/design-system/ui/toast";
import {
	Body,
	PageTitle,
	SectionHeading,
	SupportingText,
} from "#/design-system/ui/typography";
import {
	decideContributionAppeal,
	resolveOrganizationAppeal,
	updateAppealPortalSettings,
} from "#/lib/contribution-appeals.functions";
import { contributionAppealPortalOptions } from "#/lib/contribution-appeals.query";

interface AdminPortalProps {
	org: string;
	orgName: string;
	avatarHue: number | null;
	canManage: boolean;
	settings: AppealPortalSettings;
	inbox: {
		contributions: Array<{
			id: string;
			runId: string;
			repo: string;
			repoName: string;
			subjectKind: "issue" | "change-request";
			subjectNumber: number;
			login: string;
			reason: string;
		}>;
		organizationAppeals: Array<{
			id: string;
			accountId: string;
			type: "issue" | "pull-request" | "other";
			reason: string;
		}>;
	};
}

export function AppealAdminPortal({
	org,
	orgName,
	avatarHue,
	canManage,
	settings,
	inbox,
}: AdminPortalProps) {
	const client = useQueryClient();
	const options = contributionAppealPortalOptions(org);
	const refresh = () =>
		client.invalidateQueries({ queryKey: options.queryKey });
	const decide = useMutation({
		mutationFn: (input: {
			appealId: string;
			repo: string;
			decision: ContributionAppealDecision;
		}) => decideContributionAppeal({ data: { org, ...input } }),
		onSuccess: async () => {
			await refresh();
			toast.success("Appeal resolved");
		},
		onError: () => toast.fail("Tripwire couldn't resolve the appeal."),
	});
	const resolve = useMutation({
		mutationFn: (appealId: string) =>
			resolveOrganizationAppeal({ data: { org, appealId } }),
		onSuccess: async () => {
			await refresh();
			toast.success("Appeal resolved");
		},
		onError: () => toast.fail("Tripwire couldn't resolve the appeal."),
	});
	const total = inbox.contributions.length + inbox.organizationAppeals.length;

	return (
		<>
			<div data-layout-role="appeal-admin-heading">
				<OrgAvatar
					decorative={false}
					hue={avatarHue}
					name={orgName}
					size="lg"
				/>
				<div data-layout-role="appeal-admin-heading-copy">
					<SupportingText>{orgName}</SupportingText>
					<PageTitle>Appeal portal</PageTitle>
					<SupportingText>
						Review contributor appeals and control the guidance shown on the
						public portal.
					</SupportingText>
				</div>
			</div>
			<div data-layout-role="appeal-admin-grid">
				<section
					aria-labelledby="appeal-inbox-heading"
					data-layout-role="appeal-admin-section"
				>
					<div data-layout-role="appeal-section-header">
						<SectionHeading id="appeal-inbox-heading">Inbox</SectionHeading>
						<SupportingText>{total} pending</SupportingText>
					</div>
					{total === 0 ? (
						<Empty size="sm">
							<EmptyHeader>
								<EmptyTitle>No pending appeals</EmptyTitle>
								<EmptyDescription>
									New requests will appear here for review.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div data-layout-role="appeal-card-list">
							{inbox.organizationAppeals.map((appeal) => (
								<Card key={appeal.id}>
									<CardHeader>
										<CardTitle>General appeal</CardTitle>
										<CardDescription>
											{appeal.type === "issue"
												? "Issue moderation"
												: appeal.type === "pull-request"
													? "Pull request moderation"
													: "Other moderation problem"}
										</CardDescription>
									</CardHeader>
									<CardContent>
										<Body as="span" data-layout-role="appeal-reason">
											{appeal.reason}
										</Body>
									</CardContent>
									{canManage ? (
										<CardFooter>
											<Button
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
									) : null}
								</Card>
							))}
							{inbox.contributions.map((appeal) => (
								<Card key={appeal.id}>
									<CardHeader>
										<CardTitle>
											{appeal.subjectKind === "issue"
												? "Issue"
												: "Pull request"}{" "}
											#{appeal.subjectNumber}
										</CardTitle>
										<CardDescription>
											@{appeal.login} · {appeal.repoName}
										</CardDescription>
									</CardHeader>
									<CardContent>
										<Body as="span" data-layout-role="appeal-reason">
											{appeal.reason}
										</Body>
									</CardContent>
									{canManage ? (
										<CardFooter className="flex-wrap">
											<Button
												onClick={() =>
													decide.mutate({
														appealId: appeal.id,
														repo: appeal.repo,
														decision: "approve-once",
													})
												}
												size="sm"
												variant="secondary"
											>
												Approve
											</Button>
											<Button
												onClick={() =>
													decide.mutate({
														appealId: appeal.id,
														repo: appeal.repo,
														decision: "deny",
													})
												}
												size="sm"
												variant="secondary"
											>
												Deny
											</Button>
										</CardFooter>
									) : null}
								</Card>
							))}
						</div>
					)}
				</section>
				<PortalSettings canManage={canManage} org={org} settings={settings} />
			</div>
		</>
	);
}

function PortalSettings({
	org,
	settings,
	canManage,
}: {
	org: string;
	settings: AppealPortalSettings;
	canManage: boolean;
}) {
	const client = useQueryClient();
	const [title, setTitle] = useState(settings.title);
	const [description, setDescription] = useState(settings.description);
	const dirty =
		title !== settings.title || description !== settings.description;
	const save = useMutation({
		mutationFn: () =>
			updateAppealPortalSettings({
				data: { org, settings: { title, description } },
			}),
		onSuccess: async () => {
			await client.invalidateQueries({
				queryKey: contributionAppealPortalOptions(org).queryKey,
			});
			toast.success("Portal settings saved");
		},
		onError: () => toast.fail("Tripwire couldn't save the portal settings."),
	});
	return (
		<section
			aria-labelledby="portal-settings-heading"
			data-layout-role="appeal-admin-section"
		>
			<SectionHeading id="portal-settings-heading">
				Portal settings
			</SectionHeading>
			<form
				className="shell"
				onSubmit={(event) => {
					event.preventDefault();
					if (dirty && title.trim() && description.trim()) save.mutate();
				}}
			>
				<div className="panel" data-layout-role="appeal-settings-fields">
					<Field>
						<FieldLabel>Title</FieldLabel>
						<Input
							disabled={!canManage}
							maxLength={80}
							onChange={(event) => setTitle(event.target.value)}
							value={title}
						/>
					</Field>
					<Field>
						<FieldLabel>Introduction</FieldLabel>
						<Textarea
							disabled={!canManage}
							maxLength={500}
							onChange={(event) => setDescription(event.target.value)}
							rows={5}
							value={description}
						/>
					</Field>
					<SupportingText>
						This copy is shown to contributors before they submit an appeal.
					</SupportingText>
				</div>
				{canManage ? (
					<div className="shell-foot justify-end">
						<Button
							disabled={!dirty || !title.trim() || !description.trim()}
							pending={save.isPending}
							size="sm"
							type="submit"
						>
							Save changes
						</Button>
					</div>
				) : null}
			</form>
		</section>
	);
}
