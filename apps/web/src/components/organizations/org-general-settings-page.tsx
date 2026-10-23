import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { orgSlugSchema } from "@tripwire/contracts";
import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogConfirmField,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import {
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { authQueryKeys } from "#/lib/auth.query";
import type { OrgWithRole } from "#/lib/org.functions";
import { deleteOrg, updateOrg } from "#/lib/org.functions";
import {
	orgCascadeQueryOptions,
	orgContextQueryOptions,
	orgQueryKeys,
} from "#/lib/org.query";
import { setOrgTimezone } from "#/lib/timezone.functions";

export function OrgGeneralSettingsPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const canManage = useOrgPermission(org, "settings:manage");

	return (
		<SkeletonSwap
			fallback={<OrgGeneralSettingsPageSkeleton />}
			label="Loading org settings"
			loading={!orgContext}
		>
			{orgContext ? (
				<div className="flex flex-col gap-8">
					{canManage ? (
						<>
							<RenameSection
								key={orgContext.id}
								org={org}
								orgContext={orgContext}
							/>
							<TimezoneSection
								canManage
								org={org}
								timezone={orgContext.timezone}
							/>
							<DangerZone org={org} orgContext={orgContext} />
						</>
					) : (
						<>
							<ReadOnlySection orgContext={orgContext} />
							<TimezoneSection
								canManage={false}
								org={org}
								timezone={orgContext.timezone}
							/>
						</>
					)}
				</div>
			) : null}
		</SkeletonSwap>
	);
}

function SectionHeading({
	id,
	title,
	description,
}: {
	id: string;
	title: string;
	description: string;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<h3 className="type-heading-sm" id={id}>
				{title}
			</h3>
			<p className="type-body-sm text-text-2">{description}</p>
		</div>
	);
}

function ReadOnlySection({ orgContext }: { orgContext: OrgWithRole }) {
	return (
		<section
			aria-labelledby="org-general-heading"
			className="flex flex-col gap-3"
		>
			<SectionHeading
				description="Only admins can rename this org."
				id="org-general-heading"
				title="General"
			/>
			<div className="flex items-center gap-3">
				<OrgAvatar
					hue={orgContext.avatarHue}
					name={orgContext.name}
					size="xl"
				/>
				<div className="flex min-w-0 flex-col">
					<p className="type-label">{orgContext.name}</p>
					<p className="type-code-sm text-text-2">/{orgContext.slug}</p>
				</div>
			</div>
		</section>
	);
}

function RenameSection({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState(orgContext.name);
	const [slug, setSlug] = useState(orgContext.slug);

	const slugResult = orgSlugSchema.safeParse(slug);
	const slugError =
		slug === orgContext.slug || slugResult.success
			? null
			: (slugResult.error?.issues[0]?.message ??
				"Use lowercase letters, numbers and hyphens, 3 to 32 characters.");

	const nameError =
		name.trim().length === 0 ? "Enter a name for the org." : null;
	const dirty = name !== orgContext.name || slug !== orgContext.slug;

	const saveMutation = useMutation({
		mutationFn: () =>
			updateOrg({
				data: {
					org,
					...(name !== orgContext.name ? { name } : {}),
					...(slug !== orgContext.slug ? { slug } : {}),
				},
			}),
		onSuccess: (result) => {
			if ("error" in result) {
				toast.fail(result.error);
				return;
			}
			toast.success("Org saved");
			if (result.slug !== org) {
				navigate({
					to: "/$org/home",
					params: { org: result.slug },
					search: { settings: "settings" },
				});
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.detail(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() });
		},
	});

	return (
		<section
			aria-labelledby="org-general-heading"
			className="flex flex-col gap-3"
		>
			<SectionHeading
				description="Tripwire draws the avatar from the name."
				id="org-general-heading"
				title="General"
			/>
			<form
				className="flex max-w-md flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (dirty && !slugError && !nameError) {
						saveMutation.mutate();
					}
				}}
			>
				<div className="flex items-end gap-3">
					<OrgAvatar
						animate
						hue={name === orgContext.name ? orgContext.avatarHue : undefined}
						name={name}
						size="xl"
					/>
					<Field className="min-w-0 flex-1" invalid={nameError !== null}>
						<FieldLabel>Name</FieldLabel>
						<Input
							onChange={(e) => setName(e.target.value)}
							placeholder="Acme"
							value={name}
						/>
						{nameError ? <FieldError>{nameError}</FieldError> : null}
					</Field>
				</div>
				<Field invalid={slugError !== null}>
					<FieldLabel>Slug</FieldLabel>
					<Input
						mono
						onChange={(e) => setSlug(e.target.value)}
						placeholder="acme"
						value={slug}
					/>
					{slugError ? (
						<FieldError>{slugError}</FieldError>
					) : (
						<FieldDescription>
							Lowercase letters, numbers and hyphens, 3 to 32 characters. The
							slug is part of every link to this org, so old links stop working
							when you change it.
						</FieldDescription>
					)}
				</Field>
				<div>
					<Button
						disabled={!dirty || slugError !== null || nameError !== null}
						pending={saveMutation.isPending}
						pendingLabel="Saving"
						type="submit"
					>
						Save changes
					</Button>
				</div>
			</form>
		</section>
	);
}

function TimezoneSection({
	org,
	timezone,
	canManage,
}: {
	org: string;
	timezone: string | null;
	canManage: boolean;
}) {
	const queryClient = useQueryClient();
	const save = useMutation({
		mutationFn: (next: string | null) =>
			setOrgTimezone({ data: { org, timezone: next } }),
		onSuccess: () => toast.success("Timezone saved"),
		onError: () =>
			toast.fail("Tripwire could not save the timezone. Try again."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.detail(org) }),
	});
	return (
		<section
			aria-labelledby="org-timezone-heading"
			className="flex max-w-md flex-col gap-3"
		>
			<SectionHeading
				description="New schedules start in this zone, and it shows times for members who have not picked their own."
				id="org-timezone-heading"
				title="Timezone"
			/>
			<TimezonePicker
				disabled={!canManage || save.isPending}
				labelledBy="org-timezone-heading"
				onChange={(next) => save.mutate(next)}
				unsetLabel="UTC, the default"
				value={timezone}
			/>
		</section>
	);
}

function DangerZone({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	if (orgContext.isPersonal) {
		return (
			<section aria-labelledby="org-delete-heading">
				<SectionHeading
					description="This is your personal org. Tripwire keeps it, so it can't be deleted."
					id="org-delete-heading"
					title="Delete org"
				/>
			</section>
		);
	}
	return <DeleteOrgSection org={org} orgName={orgContext.name} />;
}

function DeleteOrgSection({ org, orgName }: { org: string; orgName: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);

	const { data: cascade } = useQuery({
		...orgCascadeQueryOptions(org),
		enabled: open,
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const result = await deleteOrg({ data: { org, confirmName: orgName } });
			if (!result.ok) {
				throw new Error(
					result.error ?? "Tripwire couldn't delete the org. Try again.",
				);
			}
			return result;
		},
		onSuccess: async () => {
			// Pick the destination BEFORE touching the cache, from the org list we
			// already hold, minus the one just deleted.
			const remaining = (
				queryClient.getQueryData<OrgWithRole[]>(orgQueryKeys.mine()) ?? []
			).filter((entry) => entry.slug !== org);
			// Personal first: it always exists and can never be deleted, so it is the
			// one destination guaranteed to resolve no matter how many orgs remain.
			// Server order is already personal-first, so the fallback agrees.
			const next = remaining.find((entry) => entry.isPersonal) ?? remaining[0];

			// Drop the dead org's cache and re-read the session BEFORE navigating.
			// `/` redirects on `session.defaultOrgSlug`, which is served from cache
			// and still names the deleted org — landing there threw `notFound()` on
			// `/$org` and tripped the error boundary instead of going home.
			queryClient.removeQueries({ queryKey: orgQueryKeys.detail(org) });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() }),
				queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
			]);

			toast.success(`Deleted ${orgName}`);
			// Straight to a known-good org rather than via `/`, and without the
			// `?settings=` param that would reopen this dialog on the new org.
			if (next) {
				navigate({ to: "/$org/home", params: { org: next.slug } });
				return;
			}
			navigate({ to: "/" });
		},
	});

	return (
		<section
			aria-labelledby="org-delete-heading"
			className="flex flex-col items-start gap-3"
		>
			<SectionHeading
				description="Deletes the org with its members, invite links, rules and workflows. This can't be undone."
				id="org-delete-heading"
				title="Delete org"
			/>
			<Button onClick={() => setOpen(true)} size="sm" variant="secondary">
				Delete org
			</Button>
			<Dialog
				confirmText={orgName}
				onOpenChange={setOpen}
				open={open}
				role="alertdialog"
			>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Delete {orgName}?</DialogTitle>
						<DialogDescription>
							This can't be undone. Tripwire keeps the event history.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<SkeletonSwap
							fallback={<SkeletonText lines={2} type="body-sm" />}
							label="Loading what this deletes"
							loading={!cascade}
						>
							{cascade ? (
								<p className="text-text-2">
									This deletes {cascade.members} members, {cascade.inviteLinks}{" "}
									invite links, {cascade.installations} forge connections,{" "}
									{cascade.ruleConfigs} rule settings and {cascade.workflows}{" "}
									workflows. Tripwire stops watching its {cascade.repos} repos.
								</p>
							) : null}
						</SkeletonSwap>
						<DialogConfirmField />
					</DialogBody>
					<DialogFooter>
						<DialogClose>Cancel</DialogClose>
						<DialogAction
							onAction={() => deleteMutation.mutateAsync()}
							pendingLabel="Deleting"
							variant="destructive"
						>
							Delete org
						</DialogAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

export function OrgGeneralSettingsPageSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-8">
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<SkeletonText className="w-20" type="heading-sm" />
					<SkeletonText className="w-60" type="body-sm" />
				</div>
				<div className="flex max-w-md flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<SkeletonText className="w-12" type="label" />
						<Skeleton className="h-(--control) w-full rounded-pill" />
					</div>
					<div className="flex flex-col gap-1.5">
						<SkeletonText className="w-10" type="label" />
						<Skeleton className="h-(--control) w-full rounded-pill" />
					</div>
				</div>
			</div>
		</div>
	);
}
