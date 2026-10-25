import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { orgSlugSchema } from "@tripwire/contracts";
import { useState } from "react";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { Button } from "#/components/glaze/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import {
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	SettingsHeader,
	SettingsSection,
} from "#/components/settings/settings-frame";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { authQueryKeys } from "#/lib/auth.query";
import type { OrgWithRole } from "#/lib/org.functions";
import { deleteOrg, updateOrg } from "#/lib/org.functions";
import { orgContextQueryOptions, orgQueryKeys } from "#/lib/org.query";
import { setOrgTimezone } from "#/lib/timezone.functions";

export function OrgGeneralSettingsPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const canManage = useOrgPermission(org, "settings:manage");

	return (
		<>
			<SettingsHeader title="General" />
			<SkeletonSwap
				fallback={<OrgGeneralSettingsSkeleton />}
				label="Loading org settings"
				loading={!orgContext}
			>
				{orgContext ? (
					<div className="flex flex-col gap-6">
						{canManage ? (
							<RenameCard
								key={orgContext.id}
								org={org}
								orgContext={orgContext}
							/>
						) : (
							<ReadOnlyCard orgContext={orgContext} />
						)}
						<TimezoneSection
							canManage={canManage}
							org={org}
							timezone={orgContext.timezone}
						/>
						{canManage && !orgContext.isPersonal ? (
							<DeleteOrgRow org={org} orgContext={orgContext} />
						) : null}
					</div>
				) : null}
			</SkeletonSwap>
		</>
	);
}

function ReadOnlyCard({ orgContext }: { orgContext: OrgWithRole }) {
	return (
		<div className="shell">
			<dl className="panel flex flex-col gap-4 p-4">
				<div className="flex flex-col gap-1">
					<dt className="type-label">Name</dt>
					<dd className="type-body text-text-2">{orgContext.name}</dd>
				</div>
				<div className="flex flex-col gap-1">
					<dt className="type-label">Slug</dt>
					<dd className="type-code-sm text-text-2">/{orgContext.slug}</dd>
				</div>
			</dl>
		</div>
	);
}

function RenameCard({
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
					to: "/$org/settings/general",
					params: { org: result.slug },
				});
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.detail(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() });
		},
	});

	return (
		<form
			className="shell"
			onSubmit={(event) => {
				event.preventDefault();
				if (dirty && !slugError && !nameError) {
					saveMutation.mutate();
				}
			}}
		>
			<div className="panel flex flex-col gap-4 p-4">
				<Field className="max-w-90" invalid={nameError !== null}>
					<FieldLabel>Name</FieldLabel>
					<Input
						onChange={(event) => setName(event.target.value)}
						value={name}
					/>
					{nameError ? <FieldError>{nameError}</FieldError> : null}
				</Field>
				<Field className="max-w-90" invalid={slugError !== null}>
					<FieldLabel>Slug</FieldLabel>
					<Input
						leading="/"
						mono
						onChange={(event) => setSlug(event.target.value)}
						value={slug}
					/>
					{slugError ? <FieldError>{slugError}</FieldError> : null}
				</Field>
			</div>
			{dirty ? (
				<div className="shell-foot justify-end">
					<Button
						onClick={() => {
							setName(orgContext.name);
							setSlug(orgContext.slug);
						}}
						size="sm"
						type="button"
						variant="secondary"
					>
						Discard
					</Button>
					<Button
						disabled={slugError !== null || nameError !== null}
						pending={saveMutation.isPending}
						pendingLabel="Saving"
						size="sm"
						type="submit"
					>
						Save changes
					</Button>
				</div>
			) : null}
		</form>
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
		<SettingsSection id="org-timezone" title="Timezone">
			<div className="max-w-90">
				<TimezonePicker
					disabled={!canManage || save.isPending}
					labelledBy="org-timezone-heading"
					onChange={(next) => save.mutate(next)}
					unsetLabel="UTC, the default"
					value={timezone}
				/>
			</div>
		</SettingsSection>
	);
}

function DeleteOrgRow({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const orgName = orgContext.name;

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
			const remaining = (
				queryClient.getQueryData<OrgWithRole[]>(orgQueryKeys.mine()) ?? []
			).filter((entry) => entry.slug !== org);
			const next = remaining.find((entry) => entry.isPersonal) ?? remaining[0];

			queryClient.removeQueries({ queryKey: orgQueryKeys.detail(org) });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() }),
				queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
			]);

			toast.success(`Deleted ${orgName}`);
			if (next) {
				navigate({ to: "/$org/home", params: { org: next.slug } });
				return;
			}
			navigate({ to: "/" });
		},
	});

	return (
		<div className="flex items-center justify-between gap-3 border-line-faint border-t pt-4">
			<p className="type-label">Delete org</p>
			<Button onClick={() => setOpen(true)} size="sm" variant="secondary">
				Delete org
			</Button>
			<ConfirmDeleteDialog
				actionLabel="Delete org"
				confirmText={orgName}
				description="This can't be undone."
				media={
					<OrgAvatar
						animate
						hue={orgContext.avatarHue}
						name={orgName}
						replayToken={open ? 1 : 0}
						size="xl"
					/>
				}
				onConfirm={() => deleteMutation.mutateAsync()}
				onOpenChange={setOpen}
				open={open}
				title={`Delete ${orgName}?`}
			/>
		</div>
	);
}

function OrgGeneralSettingsSkeleton() {
	return (
		<div aria-hidden className="shell">
			<div className="panel flex flex-col gap-4 p-4">
				<div className="flex max-w-90 flex-col gap-1.5">
					<SkeletonText className="w-12" type="label" />
					<Skeleton className="h-(--control) w-full rounded-pill" />
				</div>
				<div className="flex max-w-90 flex-col gap-1.5">
					<SkeletonText className="w-10" type="label" />
					<Skeleton className="h-(--control) w-full rounded-pill" />
				</div>
			</div>
		</div>
	);
}
