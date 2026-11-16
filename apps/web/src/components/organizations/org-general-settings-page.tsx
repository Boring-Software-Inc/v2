import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { orgSlugSchema } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	Input,
} from "@tripwire/ui/field";
import { Skeleton, SkeletonSwap, SkeletonText } from "@tripwire/ui/skeleton";
import { notify } from "@tripwire/ui/toast";
import { type ReactNode, useState } from "react";
import { Section } from "#/components/layouts/section";
import { DeleteOrgDialog } from "#/components/organizations/delete-org-dialog";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { OrgModerationDefaults } from "#/components/organizations/org-moderation-defaults";
import {
	SettingsHeader,
	SettingsPanel,
} from "#/components/settings/settings-frame";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { useOrgPermission } from "#/hooks/use-org-permission";
import type { OrgWithRole } from "#/lib/org.functions";
import { updateOrg } from "#/lib/org.functions";
import { orgContextQueryOptions, orgQueryKeys } from "#/lib/org.query";
import { setOrgTimezone } from "#/lib/timezone.functions";

export function OrgGeneralSettingsPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const canManage = useOrgPermission(org, "settings:manage");

	return (
		<>
			<SettingsHeader
				description="Manage organization details and defaults."
				title="General"
			/>
			<SkeletonSwap
				fallback={<OrgGeneralSettingsSkeleton />}
				label="Loading org settings"
				loading={!orgContext}
			>
				{orgContext ? (
					<div
						className="flex flex-col"
						data-layout-role="org-settings-sections"
					>
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
						<OrgModerationDefaults canManage={canManage} org={org} />
						{canManage && !orgContext.isPersonal ? (
							<DeleteOrgRow org={org} orgContext={orgContext} />
						) : null}
					</div>
				) : null}
			</SkeletonSwap>
		</>
	);
}

function OrganizationDetailsPanel({
	id = "org-details",
	children,
}: {
	id?: string;
	children: ReactNode;
}) {
	return (
		<Section id={id}>
			<div className="shell" data-layout-role="organization-details">
				<h2 id={`${id}-heading`}>Organization details</h2>
				<div className="panel" data-layout-role="organization-details-body">
					{children}
				</div>
			</div>
		</Section>
	);
}

function OrganizationDetailsLogo({
	name,
	hue,
}: Pick<OrgWithRole, "name"> & { hue: OrgWithRole["avatarHue"] }) {
	return (
		<div className="flex items-center composition-gap-group">
			<OrgAvatar
				animate
				className="organization-details-avatar size-16 shrink-0"
				hue={hue}
				name={name}
			/>
			<div>
				<p className="content-label">Logo</p>
				<p className="content-body-small tone-content-secondary">
					Generated from your organization name.
				</p>
			</div>
		</div>
	);
}

function ReadOnlyCard({ orgContext }: { orgContext: OrgWithRole }) {
	return (
		<OrganizationDetailsPanel>
			<OrganizationDetailsLogo
				name={orgContext.name}
				hue={orgContext.avatarHue}
			/>
			<Field>
				<FieldLabel>Name</FieldLabel>
				<FieldDescription>The name shown in Tripwire.</FieldDescription>
				<Input labelledByField readOnly value={orgContext.name} />
			</Field>
			<Field>
				<FieldLabel>Slug</FieldLabel>
				<FieldDescription>
					Used in URLs like /{orgContext.slug}/home.
				</FieldDescription>
				<Input labelledByField readOnly value={orgContext.slug} />
			</Field>
			<Field>
				<FieldLabel>ID</FieldLabel>
				<Input labelledByField readOnly value={orgContext.id} />
			</Field>
		</OrganizationDetailsPanel>
	);
}

export function orgRenamePatch(
	org: string,
	previous: Pick<OrgWithRole, "name" | "slug">,
	next: Pick<OrgWithRole, "name" | "slug">,
) {
	const data: Parameters<typeof updateOrg>[0]["data"] = { org };
	if (next.name !== previous.name) {
		data.name = next.name;
	}
	if (next.slug !== previous.slug) {
		data.slug = next.slug;
	}
	return data;
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
				data: orgRenamePatch(org, orgContext, { name, slug }),
			}),
		onSuccess: (result) => {
			if ("error" in result) {
				notify.show({ title: result.error }, "error");
				return;
			}
			notify.show({ title: "Org saved" }, "success");
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
			onSubmit={(event) => {
				event.preventDefault();
				if (dirty && !slugError && !nameError && !saveMutation.isPending) {
					saveMutation.mutate();
				}
			}}
		>
			<OrganizationDetailsPanel>
				<OrganizationDetailsLogo name={name} hue={orgContext.avatarHue} />
				<Field invalid={nameError !== null}>
					<FieldLabel>Name</FieldLabel>
					<FieldDescription>The name shown in Tripwire.</FieldDescription>
					<Input labelledByField onValueChange={setName} value={name} />
					{nameError ? <FieldError>{nameError}</FieldError> : null}
				</Field>
				<Field invalid={slugError !== null}>
					<FieldLabel>Slug</FieldLabel>
					<FieldDescription>
						Used in URLs like /{slug || orgContext.slug}/home.
					</FieldDescription>
					<Input labelledByField onValueChange={setSlug} value={slug} />
					{slugError ? <FieldError>{slugError}</FieldError> : null}
				</Field>
				<Field>
					<FieldLabel>ID</FieldLabel>
					<Input labelledByField readOnly value={orgContext.id} />
				</Field>
				<div>
					<Button
						disabled={!dirty || slugError !== null || nameError !== null}
						pending={saveMutation.isPending}
						pendingLabel="Saving"
						type="submit"
						variant="primary"
					>
						Save changes
					</Button>
				</div>
			</OrganizationDetailsPanel>
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
		onSuccess: () => notify.show({ title: "Timezone saved" }, "success"),
		onError: () =>
			notify.show(
				{ title: "Tripwire could not save the timezone. Try again." },
				"error",
			),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.detail(org) }),
	});
	return (
		<SettingsPanel id="org-timezone" title="Organization timezone">
			<div className="flex max-w-90 flex-col composition-gap-standard">
				<p className="content-body-small tone-content-secondary">
					The default for member timestamps and new workflow schedules.
				</p>
				<TimezonePicker
					disabled={!canManage || save.isPending}
					labelledBy="org-timezone-heading"
					onChange={(next) => save.mutate(next)}
					unsetLabel="Default (UTC)"
					value={timezone}
				/>
			</div>
		</SettingsPanel>
	);
}

function DeleteOrgRow({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	return (
		<SettingsPanel
			danger
			id="delete-organization"
			title="Delete organization"
			footer={<DeleteOrgDialog org={org} orgContext={orgContext} />}
		>
			<p className="content-body-small tone-content-primary">
				Permanently delete {orgContext.name} and all of its data.
			</p>
			<p className="content-caption tone-content-secondary">
				This cannot be undone.
			</p>
		</SettingsPanel>
	);
}

function OrgGeneralSettingsSkeleton() {
	return (
		<div aria-hidden>
			<OrganizationDetailsPanel id="org-details-loading">
				<div className="flex items-center composition-gap-group">
					<span
						data-skeleton-box=""
						className="organization-details-avatar size-16 shrink-0"
					>
						<Skeleton fill />
					</span>
					<span data-skeleton-line="" className="w-12">
						<SkeletonText type="label" />
					</span>
				</div>
				{["name", "slug", "id"].map((field) => (
					<div className="flex flex-col composition-gap-control" key={field}>
						<span data-skeleton-line="" className="w-12">
							<SkeletonText type="label" />
						</span>
						{field === "id" ? null : (
							<span data-skeleton-line="" className="w-36">
								<SkeletonText type="body-sm" />
							</span>
						)}
						<span
							data-skeleton-box=""
							className="h-(--control) w-full rounded-lg"
						>
							<Skeleton fill />
						</span>
					</div>
				))}
				<span data-skeleton-box="" className="h-(--control) w-28 rounded-lg">
					<Skeleton fill />
				</span>
			</OrganizationDetailsPanel>
		</div>
	);
}
