import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ADMIN_ONLY_MANAGE_REGIONS,
	customOrgRoleNameSchema,
	ORG_REGION_LABELS,
	ORG_REGIONS,
	type OrgRegion,
	type OrgScopeLevels,
	orgRoleScopesSchema,
} from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import { Dialog, type DialogProps } from "@tripwire/ui/dialog";
import { Field, FieldError, FieldLabel, Input } from "@tripwire/ui/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@tripwire/ui/item";
import { Select } from "@tripwire/ui/select";
import { SkeletonText } from "@tripwire/ui/skeleton";
import { notify } from "@tripwire/ui/toast";
import { useState } from "react";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import {
	SettingsCard,
	SettingsHeader,
} from "#/components/settings/settings-frame";
import { useOrgPermission } from "#/hooks/use-org-permission";
import type { OrgRoleView } from "#/lib/org.functions";
import {
	createOrgRole,
	deleteOrgRole,
	updateOrgRole,
} from "#/lib/org.functions";
import {
	orgContextQueryOptions,
	orgQueryKeys,
	orgRolesQueryOptions,
} from "#/lib/org.query";

type Scopes = OrgScopeLevels;

const LEVEL_ITEMS = [
	{ value: "none", label: "No access" },
	{ value: "read", label: "Read" },
	{ value: "manage", label: "Manage" },
];

const ADMIN_ONLY: readonly OrgRegion[] = ADMIN_ONLY_MANAGE_REGIONS;

function levelItems(region: OrgRegion) {
	return ADMIN_ONLY.includes(region)
		? LEVEL_ITEMS.filter((item) => item.value !== "manage")
		: LEVEL_ITEMS;
}

function scopeSummary(scopes: Scopes): string {
	const parts = ORG_REGIONS.flatMap((region) => {
		const level = scopes[region];
		return level ? [`${ORG_REGION_LABELS[region]} (${level})`] : [];
	});
	return parts.length > 0 ? parts.join(", ") : "No access";
}

export function OrgRolesPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const rolesQuery = useQuery(orgRolesQueryOptions(org));
	const canManage = useOrgPermission(org, "members:manage");
	const isPersonal = orgContext?.isPersonal ?? true;

	return (
		<>
			<SettingsHeader title="Roles">
				{canManage && !isPersonal ? (
					<RoleDialog
						org={org}
						trigger={<Button variant="primary">Create role</Button>}
					/>
				) : null}
			</SettingsHeader>
			<SettingsCard>
				<ItemGroup aria-label="Roles">
					<Item>
						<ItemContent>
							<ItemTitle>Admin</ItemTitle>
							<ItemDescription>
								Every area, and members and roles
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Badge variant="outline">Built in</Badge>
						</ItemActions>
					</Item>
					<Item>
						<ItemContent>
							<ItemTitle>Member</ItemTitle>
							<ItemDescription>Reads every area</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Badge variant="outline">Built in</Badge>
						</ItemActions>
					</Item>
					{rolesQuery.isPending ? (
						<Item aria-hidden>
							<ItemContent>
								<span data-skeleton-line="" aria-hidden className="w-28">
									<SkeletonText type="label" />
								</span>
								<span data-skeleton-line="" aria-hidden className="w-56">
									<SkeletonText type="body-sm" />
								</span>
							</ItemContent>
						</Item>
					) : null}
					{(rolesQuery.data ?? []).map((role) => (
						<CustomRoleRow
							canManage={canManage}
							key={role.id}
							org={org}
							role={role}
						/>
					))}
				</ItemGroup>
			</SettingsCard>
			{rolesQuery.isError ? (
				<p className="content-body-small tone-danger">
					Tripwire couldn't load the roles. Reload to try again.
				</p>
			) : null}
		</>
	);
}

function CustomRoleRow({
	org,
	role,
	canManage,
}: {
	org: string;
	role: OrgRoleView;
	canManage: boolean;
}) {
	const queryClient = useQueryClient();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const deleteMutation = useMutation({
		mutationFn: async () => {
			const result = await deleteOrgRole({ data: { org, name: role.name } });
			if (!result.ok) {
				throw new Error(result.error);
			}
		},
		onSuccess: () =>
			notify.show({ title: `Deleted the ${role.name} role` }, "success"),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.roles(org) }),
	});

	return (
		<Item data-layout-role="org-custom-role">
			<ItemContent>
				<ItemTitle>
					<span>{role.name}</span>
					<Badge size="small">
						<span className="tabular-nums">{role.memberCount}</span>{" "}
						{role.memberCount === 1 ? "member" : "members"}
					</Badge>
				</ItemTitle>
				<ItemDescription>{scopeSummary(role.scopes)}</ItemDescription>
			</ItemContent>
			{canManage ? (
				<ItemActions>
					<RoleDialog
						initial={role}
						org={org}
						trigger={
							<Button
								ariaLabel={`Edit the ${role.name} role`}
								size="small"
								variant="secondary"
							>
								Edit
							</Button>
						}
					/>
					<Button
						ariaLabel={`Delete the ${role.name} role`}
						onAction={() => setConfirmDelete(true)}
						size="small"
						variant="secondary"
					>
						Delete
					</Button>
					<ConfirmDeleteDialog
						confirmLabel="Delete role"
						description="Give its members another role first."
						onConfirm={() => deleteMutation.mutateAsync()}
						onOpenChange={setConfirmDelete}
						open={confirmDelete}
						title={`Delete the ${role.name} role?`}
					/>
				</ItemActions>
			) : null}
		</Item>
	);
}

function RoleDialog({
	org,
	trigger,
	initial,
}: {
	org: string;
	trigger: NonNullable<DialogProps["trigger"]>;
	initial?: OrgRoleView;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initial?.name ?? "");
	const [scopes, setScopes] = useState<Scopes>(initial?.scopes ?? {});
	const nameResult = customOrgRoleNameSchema.safeParse(name);
	const scopesResult = orgRoleScopesSchema.safeParse(scopes);
	const nameError =
		initial || name.length === 0 || nameResult.success
			? null
			: (nameResult.error.issues[0]?.message ?? "Enter a valid name.");

	const saveMutation = useMutation({
		mutationFn: async () => {
			if (!nameResult.success || !scopesResult.success) {
				throw new Error("Pick a name and at least one area.");
			}
			const data = { org, name: nameResult.data, scopes: scopesResult.data };
			const result = initial
				? await updateOrgRole({ data })
				: await createOrgRole({ data });
			if (!result.ok) {
				throw new Error(result.error);
			}
		},
		onSuccess: () =>
			notify.show(
				{
					title: initial
						? `Saved the ${initial.name} role`
						: `Created the ${name.trim().toLowerCase()} role`,
				},
				"success",
			),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.roles(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.detail(org) });
		},
	});

	const setLevel = (region: OrgRegion, value: string | null) => {
		setScopes((prev) => {
			const { [region]: _previous, ...rest } = prev;
			return value === "read" || value === "manage"
				? { ...rest, [region]: value }
				: rest;
		});
	};

	return (
		<Dialog
			action={{
				disabled: !nameResult.success || !scopesResult.success,
				label: initial ? "Save role" : "Create role",
				onAction: () => saveMutation.mutateAsync(),
				pendingLabel: "Saving",
			}}
			onOpenChange={(open) => {
				if (open) {
					setName(initial?.name ?? "");
					setScopes(initial?.scopes ?? {});
				}
			}}
			title={initial ? `Edit the ${initial.name} role` : "Create role"}
			trigger={trigger}
		>
			<div>
				{initial ? null : (
					<Field invalid={nameError !== null}>
						<FieldLabel>Name</FieldLabel>
						<Input
							autoComplete="off"
							labelledByField
							onValueChange={setName}
							placeholder="moderator"
							value={name}
						/>
						{nameError ? <FieldError>{nameError}</FieldError> : null}
					</Field>
				)}
				<div className="flex flex-col composition-gap-standard">
					{ORG_REGIONS.map((region) => (
						<div
							className="flex items-center justify-between composition-gap-section"
							key={region}
						>
							<span className="content-label">{ORG_REGION_LABELS[region]}</span>
							<div className="w-32">
								<Select
									ariaLabel={`${ORG_REGION_LABELS[region]} access`}
									onValueChange={(value) => setLevel(region, value)}
									options={levelItems(region)}
									value={scopes[region] ?? "none"}
								/>
							</div>
						</div>
					))}
				</div>
			</div>
		</Dialog>
	);
}
