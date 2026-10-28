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
import { useState } from "react";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import { Field, FieldError, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
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
	const [creating, setCreating] = useState(false);

	return (
		<>
			<SettingsHeader title="Roles">
				{canManage && !isPersonal ? (
					<Button onClick={() => setCreating(true)}>Create role</Button>
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
								<SkeletonText className="w-28" type="label" />
								<SkeletonText className="w-56" type="body-sm" />
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
				<p className="type-body-sm text-fail-text">
					Tripwire couldn't load the roles. Reload to try again.
				</p>
			) : null}
			{creating ? (
				<RoleDialog onOpenChange={setCreating} open org={org} />
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
	const [editing, setEditing] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const deleteMutation = useMutation({
		mutationFn: async () => {
			const result = await deleteOrgRole({ data: { org, name: role.name } });
			if (!result.ok) {
				throw new Error(result.error);
			}
		},
		onSuccess: () => toast.success(`Deleted the ${role.name} role`),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.roles(org) }),
	});

	return (
		<Item className="flex-wrap">
			<ItemContent>
				<ItemTitle>
					<span>{role.name}</span>
					<Badge size="sm">
						<span className="tabular-nums">{role.memberCount}</span>{" "}
						{role.memberCount === 1 ? "member" : "members"}
					</Badge>
				</ItemTitle>
				<ItemDescription>{scopeSummary(role.scopes)}</ItemDescription>
			</ItemContent>
			{canManage ? (
				<ItemActions className="gap-2">
					<Button
						aria-label={`Edit the ${role.name} role`}
						onClick={() => setEditing(true)}
						size="sm"
						variant="secondary"
					>
						Edit
					</Button>
					<Button
						aria-label={`Delete the ${role.name} role`}
						onClick={() => setConfirmDelete(true)}
						size="sm"
						variant="secondary"
					>
						Delete
					</Button>
					{editing ? (
						<RoleDialog
							initial={role}
							onOpenChange={setEditing}
							open
							org={org}
						/>
					) : null}
					<ConfirmDeleteDialog
						actionLabel="Delete role"
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
	open,
	onOpenChange,
	initial,
}: {
	org: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
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
			toast.success(
				initial
					? `Saved the ${initial.name} role`
					: `Created the ${name.trim().toLowerCase()} role`,
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
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{initial ? `Edit the ${initial.name} role` : "Create role"}
					</DialogTitle>
				</DialogHeader>
				<DialogBody>
					{initial ? null : (
						<Field invalid={nameError !== null}>
							<FieldLabel>Name</FieldLabel>
							<Input
								autoComplete="off"
								onChange={(event) => setName(event.target.value)}
								placeholder="moderator"
								value={name}
							/>
							{nameError ? <FieldError>{nameError}</FieldError> : null}
						</Field>
					)}
					<div className="flex flex-col gap-2">
						{ORG_REGIONS.map((region) => (
							<div
								className="flex items-center justify-between gap-3"
								key={region}
							>
								<span className="type-label">{ORG_REGION_LABELS[region]}</span>
								<Select
									items={levelItems(region)}
									onValueChange={(value) => setLevel(region, value)}
									value={scopes[region] ?? "none"}
								>
									<SelectTrigger
										aria-label={`${ORG_REGION_LABELS[region]} access`}
										className="w-32"
										size="sm"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent size="sm">
										{levelItems(region).map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						))}
					</div>
				</DialogBody>
				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					<DialogAction
						disabled={!nameResult.success || !scopesResult.success}
						onAction={() => saveMutation.mutateAsync()}
						pendingLabel="Saving"
					>
						{initial ? "Save role" : "Create role"}
					</DialogAction>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
