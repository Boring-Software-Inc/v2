import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { AgentBoundary } from "@tripwire/ui/agent-policy";
import { Avatar } from "@tripwire/ui/avatar";
import {
	Button,
	DestructiveDialogLauncher,
	IconButton,
} from "@tripwire/ui/button";
import { Dialog } from "@tripwire/ui/dialog";
import { Field, FieldError, FieldLabel, Input } from "@tripwire/ui/field";
import { Icon, More } from "@tripwire/ui/icon";
import { Menu } from "@tripwire/ui/menu";
import { NumberInput } from "@tripwire/ui/number-input";
import { Select } from "@tripwire/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableEmpty,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "@tripwire/ui/table";
import { Tabs } from "@tripwire/ui/tabs";
import { notify } from "@tripwire/ui/toast";
import { Caption, Label, SupportingText } from "@tripwire/ui/typography";
import { type ReactNode, useState } from "react";
import { CollectionControls } from "#/components/collection/collection";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { EmptyStateRetry } from "#/components/common/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	INVITES_COLLECTION,
	MEMBERS_COLLECTION,
} from "#/components/organizations/org-members-collection";
import {
	SettingsDangerRow,
	SettingsHeader,
} from "#/components/settings/settings-frame";
import {
	type CollectionController,
	useCollection,
} from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import type { InviteLinkView, OrgMemberView } from "#/lib/org.functions";
import {
	createOrgInvite,
	leaveOrg,
	removeOrgMember,
	revokeOrgInvite,
	updateOrgMemberRole,
} from "#/lib/org.functions";
import {
	orgContextQueryOptions,
	orgInvitesQueryOptions,
	orgMembersQueryOptions,
	orgQueryKeys,
	orgRolesQueryOptions,
} from "#/lib/org.query";

const ROLE_ITEMS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
];

const ROLE_LABEL = {
	admin: "Admin",
	member: "Member",
} satisfies Record<OrgRole, string>;

const DAY_MS = 24 * 60 * 60 * 1000;

function roleLabel(role: string): string {
	return isOrgRole(role) ? ROLE_LABEL[role] : role;
}

function isOrgRole(value: string | null): value is OrgRole {
	return value === "admin" || value === "member";
}

export function inviteExpiryLabel(
	expiresAt: string | Date,
	now = Date.now(),
): string {
	const left = new Date(expiresAt).getTime() - now;
	if (left <= 0) {
		return "Expired";
	}
	const days = Math.ceil(left / DAY_MS);
	return days <= 1 ? "Expires today" : `Expires in ${days} days`;
}

export function shouldDeleteInsteadOfLeave(
	role: string | undefined,
	members: readonly Pick<OrgMemberView, "role">[] | undefined,
): boolean {
	return (
		role === "admin" &&
		members?.filter((member) => member.role === "admin").length === 1
	);
}

export function OrgMembersPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const membersQuery = useQuery(orgMembersQueryOptions(org));
	const members = useCollection(MEMBERS_COLLECTION, membersQuery.data, {
		store: "local",
	});
	const { data: session } = useQuery(sessionInfoQueryOptions());

	const isAdmin = useOrgPermission(org, "members:manage");
	const rolesQuery = useQuery({
		...orgRolesQueryOptions(org),
		enabled: isAdmin,
	});
	const roleItems = [
		...ROLE_ITEMS,
		...(rolesQuery.data ?? []).map((role) => ({
			value: role.name,
			label: role.name,
		})),
	];
	const isPersonal = orgContext?.isPersonal ?? true;
	const canInvite = isAdmin && !isPersonal;
	const callerUserId = session?.user?.id ?? null;
	const currentRoleIsAdmin = orgContext?.role === "admin";
	const onlyAdmin = shouldDeleteInsteadOfLeave(
		orgContext?.role,
		membersQuery.data,
	);
	const canResolveAdminExit =
		!currentRoleIsAdmin || membersQuery.data !== undefined;
	const [inviting, setInviting] = useState(false);
	const [createdToken, setCreatedToken] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"members" | "pending">("members");

	return (
		<>
			<SettingsHeader
				description="Manage who can access this workspace and what they can do."
				title="Members"
			/>
			<Tabs
				actions={
					canInvite
						? [
								{
									label: "Invite member",
									onAction: () => setInviting(true),
									value: "invite-member",
								},
							]
						: []
				}
				ariaLabel="Workspace access"
				items={[
					{
						content: (
							<SettingsCollectionTable
								collection={members}
								columns={
									isAdmin ? ["Member", "Role", "Actions"] : ["Member", "Role"]
								}
								empty={{ title: "No members" }}
								error={membersQuery.isError}
								onRetry={() => membersQuery.refetch({ throwOnError: true })}
								rowCount={3}
								scrollLabel="Members table"
							>
								{(rows) =>
									rows.map((member) => (
										<MemberRow
											callerUserId={callerUserId}
											isAdmin={isAdmin}
											key={member.memberId}
											member={member}
											org={org}
											roleItems={roleItems}
										/>
									))
								}
							</SettingsCollectionTable>
						),
						count: membersQuery.data?.length,
						label: "Members",
						value: "members",
					},
					{
						content: (
							<PendingInvitesPanel createdToken={createdToken} org={org} />
						),
						hidden: !canInvite,
						label: "Pending",
						value: "pending",
					},
				]}
				onValueChange={(value) => {
					if (value === "members" || value === "pending") {
						setActiveTab(value);
					}
				}}
				size="small"
				value={activeTab}
			/>
			{canInvite ? (
				<InviteForm
					onCreated={(token) => {
						setCreatedToken(token);
						setActiveTab("pending");
						setInviting(false);
					}}
					onOpenChange={setInviting}
					open={inviting}
					org={org}
				/>
			) : null}

			{isPersonal || !orgContext || !canResolveAdminExit || onlyAdmin ? null : (
				<LeaveOrgRow
					isAdmin={currentRoleIsAdmin}
					name={orgContext.name}
					org={org}
				/>
			)}
		</>
	);
}

function SettingsCollectionTable<Row>({
	collection,
	columns,
	rowCount,
	scrollLabel,
	empty,
	error,
	onRetry,
	children,
}: {
	collection: CollectionController<Row>;
	columns: readonly string[];
	rowCount: number;
	scrollLabel: string;
	empty: { title: string; description?: string };
	error: boolean;
	onRetry: () => Promise<unknown>;
	children: (rows: Row[]) => ReactNode;
}) {
	const { definition, loading, total, rows } = collection;
	const emptyArt = (
		<MascotArt
			mood={definition.id === "invites" ? "invites-empty" : "empty"}
			size="compact"
		/>
	);

	function renderRows() {
		if (error && loading) {
			return (
				<TableEmpty
					action={
						<EmptyStateRetry
							onRetry={async () => {
								await onRetry();
							}}
						>
							Try again
						</EmptyStateRetry>
					}
					art={emptyArt}
					colSpan={columns.length}
					reason="error"
					title="Couldn’t load this list"
				/>
			);
		}
		if (loading) {
			return <TableLoading columns={columns.length} rows={rowCount} />;
		}
		if (total === 0) {
			return <TableEmpty art={emptyArt} colSpan={columns.length} {...empty} />;
		}
		if (rows.length === 0) {
			return (
				<TableEmpty
					action={
						collection.filtered ? (
							<Button
								onAction={collection.clear}
								size="small"
								variant="secondary"
							>
								Clear filters
							</Button>
						) : null
					}
					art={emptyArt}
					colSpan={columns.length}
					reason="no-results"
					title={`No matching ${definition.noun}`}
				/>
			);
		}
		return children(rows);
	}

	return (
		<div data-layout-role="settings-collection-table">
			<CollectionControls collection={collection} compact />
			<Table
				aria-busy={loading && !error}
				aria-label={definition.noun}
				density="compact"
				scrollLabel={scrollLabel}
			>
				<TableHeader>
					<TableRow>
						{columns.map((column) => (
							<TableHead
								data-settings-action-cell={column === "Actions" || undefined}
								key={column}
							>
								{column}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>{renderRows()}</TableBody>
			</Table>
		</div>
	);
}

function MemberRow({
	org,
	member,
	isAdmin,
	callerUserId,
	roleItems,
}: {
	org: string;
	member: OrgMemberView;
	isAdmin: boolean;
	callerUserId: string | null;
	roleItems: { value: string; label: string }[];
}) {
	const queryClient = useQueryClient();
	const isSelf = callerUserId !== null && member.userId === callerUserId;

	const roleMutation = useMutation({
		mutationFn: (role: string) =>
			updateOrgMemberRole({ data: { org, memberId: member.memberId, role } }),
		onSuccess: (result, role) => {
			if (!result.ok) {
				notify.show(
					{
						title:
							result.error ??
							`Tripwire couldn't change the role for ${member.name}. Try again.`,
					},
					"error",
				);
				return;
			}
			notify.show(
				{ title: `${member.name} is now ${roleLabel(role).toLowerCase()}` },
				"success",
			);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.roles(org) });
		},
	});

	const removeMutation = useMutation({
		mutationFn: async () => {
			const result = await removeOrgMember({
				data: { org, memberId: member.memberId },
			});
			if (!result.ok) {
				throw new Error(
					result.error ?? `Tripwire couldn't remove ${member.name}. Try again.`,
				);
			}
			return result;
		},
		onSuccess: () => {
			notify.show({ title: `Removed ${member.name} from the org` }, "success");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
		},
	});

	const manage = isAdmin && !isSelf;

	return (
		<TableRow>
			<TableCell>
				<div data-layout-role="settings-member-identity">
					<Avatar
						decorative
						name={member.name}
						size="lg"
						src={member.image ?? undefined}
					/>
					<div>
						<Label>{member.name}</Label>
						{isSelf ? <SupportingText as="span"> (you)</SupportingText> : null}
						<SupportingText>{member.email}</SupportingText>
					</div>
				</div>
			</TableCell>
			<TableCell>
				{manage ? (
					<AgentBoundary visibility="hidden">
						<Select
							ariaLabel={`Role for ${member.name}`}
							disabled={roleMutation.isPending}
							options={roleItems}
							onValueChange={(value) => {
								if (value && value !== member.role) {
									roleMutation.mutate(value);
								}
							}}
							value={member.role}
						/>
					</AgentBoundary>
				) : (
					<SupportingText as="span">{roleLabel(member.role)}</SupportingText>
				)}
			</TableCell>
			{isAdmin ? (
				<TableCell data-settings-action-cell>
					{manage ? (
						<Menu
							align="end"
							ariaLabel={`Actions for ${member.name}`}
							items={[
								{
									confirmation: {
										confirmLabel: "Remove",
										description: `${member.name} will lose access to this organization.`,
										title: `Remove ${member.name}?`,
									},
									label: "Remove",
									onAction: () => removeMutation.mutateAsync(),
									tone: "destructive",
									value: "remove-member",
								},
							]}
							trigger={
								<IconButton
									icon={<Icon icon={More} />}
									label={`Actions for ${member.name}`}
									size="small"
									variant="ghost"
								/>
							}
						/>
					) : null}
				</TableCell>
			) : null}
		</TableRow>
	);
}

function LeaveOrgRow({
	org,
	name,
	isAdmin,
}: {
	org: string;
	name: string;
	isAdmin: boolean;
}) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const leaveMutation = useMutation({
		mutationFn: async () => {
			const result = await leaveOrg({ data: { org } });
			if (!result.ok) {
				throw new Error(
					result.error ??
						"You're the last admin. Make another member an admin, then leave.",
				);
			}
			return result;
		},
		onSuccess: () => {
			window.location.assign("/");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() });
		},
	});

	return (
		<SettingsDangerRow
			action={
				<AgentBoundary visibility="hidden">
					<DestructiveDialogLauncher onOpenChange={setOpen} size="small">
						Leave org
					</DestructiveDialogLauncher>
				</AgentBoundary>
			}
			label={`Leave ${name}`}
		>
			<ConfirmDeleteDialog
				confirmLabel="Leave org"
				confirmText={name}
				description={
					isAdmin
						? "You'll lose access. Another admin can invite you back."
						: "You'll lose access. An admin can invite you back."
				}
				onConfirm={() => leaveMutation.mutateAsync()}
				onOpenChange={setOpen}
				open={open}
				pendingLabel="Leaving"
				title={`Leave ${name}?`}
			/>
		</SettingsDangerRow>
	);
}

function PendingInvitesPanel({
	org,
	createdToken,
}: {
	org: string;
	createdToken: string | null;
}) {
	const invitesQuery = useQuery(orgInvitesQueryOptions(org));
	const invites = useCollection(INVITES_COLLECTION, invitesQuery.data, {
		params: { status: "invites" },
	});

	return (
		<div className="flex flex-col gap-4">
			{createdToken ? <FreshInviteLink token={createdToken} /> : null}
			<SettingsCollectionTable
				collection={invites}
				columns={["Invite link", "Usage", "Expires", "Actions"]}
				empty={{
					title: "No pending invitations",
					description:
						"Invite links appear here until they're used, expire, or are revoked.",
				}}
				error={invitesQuery.isError}
				onRetry={() => invitesQuery.refetch({ throwOnError: true })}
				rowCount={2}
				scrollLabel="Invite links table"
			>
				{(rows) =>
					rows.map((invite) => (
						<InviteLinkRow invite={invite} key={invite.id} org={org} />
					))
				}
			</SettingsCollectionTable>
		</div>
	);
}

function InviteForm({
	org,
	onCreated,
	onOpenChange,
	open,
}: {
	org: string;
	onCreated: (token: string) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const [role, setRole] = useState<OrgRole>("member");
	const [maxUses, setMaxUses] = useState(1);
	const [expiresInDays, setExpiresInDays] = useState(7);

	const createMutation = useMutation({
		mutationFn: () =>
			createOrgInvite({ data: { org, role, maxUses, expiresInDays } }),
		onSuccess: (result) => {
			if (result.token) {
				onCreated(result.token);
			} else {
				notify.show(
					{
						title:
							result.error ??
							"Tripwire couldn't create the invite link. Try again.",
					},
					"error",
				);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.invites(org) });
		},
	});

	const maxUsesValid = maxUses >= 1 && maxUses <= 1000;
	const expiryValid = expiresInDays >= 1 && expiresInDays <= 90;
	const inputsValid = maxUsesValid && expiryValid;

	return (
		<Dialog
			action={{
				disabled: !inputsValid,
				label: "Create invite link",
				onAction: async () => {
					const result = await createMutation.mutateAsync();
					if (!result.token) throw new Error(result.error ?? "Invite failed");
				},
				pendingLabel: "Creating",
			}}
			description="Choose who can use the link and when it expires."
			onOpenChange={onOpenChange}
			open={open}
			title="Create an invite link"
		>
			<form
				className="flex flex-col"
				data-layout-role="invite-dialog-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (inputsValid) {
						createMutation.mutate();
					}
				}}
			>
				<Field>
					<FieldLabel>Role</FieldLabel>
					<Select
						ariaLabel="Role"
						options={ROLE_ITEMS}
						onValueChange={(value) => {
							if (isOrgRole(value)) {
								setRole(value);
							}
						}}
						value={role}
					/>
				</Field>
				<Field invalid={!maxUsesValid}>
					<FieldLabel>Use limit</FieldLabel>
					<NumberInput
						ariaLabel="Use limit"
						max={1000}
						min={1}
						onValueChange={(value) => setMaxUses(value ?? 0)}
						value={maxUses}
					/>
					{maxUsesValid ? null : <FieldError>Enter 1 to 1000.</FieldError>}
				</Field>
				<Field invalid={!expiryValid}>
					<FieldLabel>Expires in</FieldLabel>
					<NumberInput
						ariaLabel="Expiration in days"
						max={90}
						min={1}
						onValueChange={(value) => setExpiresInDays(value ?? 0)}
						unit="days"
						value={expiresInDays}
					/>
					{expiryValid ? null : <FieldError>Enter 1 to 90 days.</FieldError>}
				</Field>
			</form>
		</Dialog>
	);
}

function FreshInviteLink({ token }: { token: string }) {
	const url = `${window.location.origin}/invite/${token}`;
	return (
		<Field>
			<FieldLabel>New invite link, shown once</FieldLabel>
			<Input
				copy={{ label: "Copy invite link", value: url }}
				labelledByField
				value={url}
			/>
		</Field>
	);
}

function InviteLinkRow({
	org,
	invite,
}: {
	org: string;
	invite: InviteLinkView;
}) {
	const queryClient = useQueryClient();
	const [confirmRevoke, setConfirmRevoke] = useState(false);
	const roleName = ROLE_LABEL[invite.role].toLowerCase();
	const revokeMutation = useMutation({
		mutationFn: async () => {
			const result = await revokeOrgInvite({
				data: { org, inviteId: invite.id },
			});
			if (!result.revoked) {
				throw new Error(
					"Tripwire couldn't revoke the link. Reload the page and try again.",
				);
			}
			return result;
		},
		onSuccess: () => {
			notify.show({ title: "Invite link revoked" }, "success");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.invites(org) });
		},
	});

	const revoked = invite.revokedAt !== null;

	return (
		<TableRow>
			<TableCell>{ROLE_LABEL[invite.role]} invite</TableCell>
			<TableCell>
				<Caption>
					{invite.uses} of {invite.maxUses} used
				</Caption>
			</TableCell>
			<TableCell>
				<Caption>
					{revoked ? "Revoked" : inviteExpiryLabel(invite.expiresAt)}
				</Caption>
			</TableCell>
			<TableCell data-settings-action-cell>
				{revoked ? null : (
					<AgentBoundary visibility="hidden">
						<DestructiveDialogLauncher
							ariaLabel={`Revoke ${roleName} invite link`}
							onOpenChange={setConfirmRevoke}
							size="small"
						>
							Revoke
						</DestructiveDialogLauncher>
					</AgentBoundary>
				)}
				<ConfirmDeleteDialog
					confirmLabel="Revoke"
					onConfirm={() => revokeMutation.mutateAsync()}
					onOpenChange={setConfirmRevoke}
					open={confirmRevoke}
					pendingLabel="Revoking"
					title="Revoke this invite link?"
				/>
			</TableCell>
		</TableRow>
	);
}
