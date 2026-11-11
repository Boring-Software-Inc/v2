import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { useId, useState } from "react";
import { Collection } from "#/components/collection/collection";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import {
	CollectionRow,
	InviteRowActions,
	InviteRowsSkeleton,
	MemberActionMenuSlot,
	MemberRoleSelectTrigger,
	MemberRowActions,
	MemberRowsSkeleton,
} from "#/components/layouts/collection-row";
import { MascotArt } from "#/components/mascot/mascot-art";
import { DeleteOrgDialog } from "#/components/organizations/delete-org-dialog";
import {
	INVITES_COLLECTION,
	MEMBERS_COLLECTION,
} from "#/components/organizations/org-members-collection";
import {
	SettingsCard,
	SettingsDangerRow,
	SettingsHeader,
	SettingsSection,
} from "#/components/settings/settings-frame";
import { Icon, More } from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Button } from "#/design-system/ui/button";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/design-system/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/design-system/ui/dropdown-menu";
import { Empty, EmptyHeader, EmptyTitle } from "#/design-system/ui/empty-state";
import { Field, FieldError, FieldLabel } from "#/design-system/ui/field";
import { Input } from "#/design-system/ui/input";
import {
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/design-system/ui/item";
import { NumberInput } from "#/design-system/ui/number-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/design-system/ui/select";
import { toast } from "#/design-system/ui/toast";
import { Caption, SupportingText } from "#/design-system/ui/typography";
import { useCollection } from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import type {
	InviteLinkView,
	OrgMemberView,
	OrgWithRole,
} from "#/lib/org.functions";
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

	return (
		<>
			<SettingsHeader title="Members">
				{canInvite ? (
					<Dialog onOpenChange={setInviting} open={inviting}>
						<DialogTrigger render={<Button />}>Invite</DialogTrigger>
						<DialogContent size="sm">
							<DialogHeader>
								<DialogTitle>Create an invite link</DialogTitle>
								<DialogDescription>
									Choose who can use the link and when it expires.
								</DialogDescription>
							</DialogHeader>
							<InviteForm
								onCreated={(token) => {
									setCreatedToken(token);
									setInviting(false);
								}}
								org={org}
							/>
						</DialogContent>
					</Dialog>
				) : null}
			</SettingsHeader>
			{createdToken ? <FreshInviteLink token={createdToken} /> : null}
			<Collection
				collection={members}
				empty={null}
				error={membersQuery.isError}
				onRetry={async () => {
					await membersQuery.refetch({ throwOnError: true });
				}}
				skeleton={<MemberRowsSkeleton />}
			>
				{(rows) => (
					<SettingsCard>
						<ItemGroup aria-label="Members">
							{rows.map((member) => (
								<MemberRow
									callerUserId={callerUserId}
									isAdmin={isAdmin}
									key={member.memberId}
									member={member}
									org={org}
									roleItems={roleItems}
								/>
							))}
						</ItemGroup>
					</SettingsCard>
				)}
			</Collection>

			{canInvite ? <InviteLinksSection org={org} /> : null}

			{isPersonal || !orgContext || !canResolveAdminExit ? null : onlyAdmin ? (
				<DeleteOrgMembershipRow org={org} orgContext={orgContext} />
			) : (
				<LeaveOrgRow
					isAdmin={currentRoleIsAdmin}
					name={orgContext.name}
					org={org}
				/>
			)}
		</>
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
	const [confirmRemove, setConfirmRemove] = useState(false);

	const roleMutation = useMutation({
		mutationFn: (role: string) =>
			updateOrgMemberRole({ data: { org, memberId: member.memberId, role } }),
		onSuccess: (result, role) => {
			if (!result.ok) {
				toast.fail(
					result.error ??
						`Tripwire couldn't change the role for ${member.name}. Try again.`,
				);
				return;
			}
			toast.success(`${member.name} is now ${roleLabel(role).toLowerCase()}`);
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
			toast.success(`Removed ${member.name} from the org`);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
		},
	});

	const manage = isAdmin && !isSelf;

	return (
		<CollectionRow
			actions={
				<MemberRowActions>
					{isSelf ? <SupportingText as="span">You</SupportingText> : null}
					{manage ? (
						<Select
							disabled={roleMutation.isPending}
							items={roleItems}
							onValueChange={(value) => {
								if (value && value !== member.role) {
									roleMutation.mutate(value);
								}
							}}
							value={member.role}
						>
							<MemberRoleSelectTrigger aria-label={`Role for ${member.name}`}>
								<SelectValue />
							</MemberRoleSelectTrigger>
							<SelectContent size="sm">
								{roleItems.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<SupportingText as="span">{roleLabel(member.role)}</SupportingText>
					)}
					{isAdmin ? (
						<MemberActionMenuSlot>
							{manage ? (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												aria-label={`Actions for ${member.name}`}
												size="icon-sm"
												variant="ghost"
											/>
										}
									>
										<Icon icon={More} />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" size="sm">
										<DropdownMenuItem
											onClick={() => setConfirmRemove(true)}
											variant="destructive"
										>
											Remove
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : null}
						</MemberActionMenuSlot>
					) : null}
				</MemberRowActions>
			}
			content={
				<ItemContent>
					<ItemTitle>{member.name}</ItemTitle>
					<ItemDescription>{member.email}</ItemDescription>
				</ItemContent>
			}
			media={
				<ItemMedia>
					<Avatar
						decorative
						name={member.name}
						size="lg"
						src={member.image ?? undefined}
					/>
				</ItemMedia>
			}
			overlay={
				<ConfirmDeleteDialog
					actionLabel="Remove"
					onConfirm={() => removeMutation.mutateAsync()}
					onOpenChange={setConfirmRemove}
					open={confirmRemove}
					pendingLabel="Removing"
					title={`Remove ${member.name}?`}
				/>
			}
		/>
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
				<Button
					confirmation={false}
					onClick={() => setOpen(true)}
					size="sm"
					variant="destructive"
				>
					Leave org
				</Button>
			}
			label={`Leave ${name}`}
		>
			<ConfirmDeleteDialog
				actionLabel="Leave org"
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

function DeleteOrgMembershipRow({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	const [open, setOpen] = useState(false);
	return (
		<SettingsDangerRow
			action={
				<Button
					confirmation={false}
					onClick={() => setOpen(true)}
					size="sm"
					variant="destructive"
				>
					Delete org
				</Button>
			}
			label={`Delete ${orgContext.name}`}
		>
			<DeleteOrgDialog
				onOpenChange={setOpen}
				open={open}
				org={org}
				orgContext={orgContext}
			/>
		</SettingsDangerRow>
	);
}

function InviteLinksSection({ org }: { org: string }) {
	const invitesQuery = useQuery(orgInvitesQueryOptions(org));
	const invites = useCollection(INVITES_COLLECTION, invitesQuery.data, {
		params: { status: "invites" },
	});

	return (
		<SettingsSection id="invite-links" title="Invite links">
			<Collection
				collection={invites}
				empty={
					<Empty
						art={<MascotArt mood="invites-empty" size="compact" />}
						size="sm"
						variant="plain"
					>
						<EmptyHeader>
							<EmptyTitle>No invite links yet</EmptyTitle>
						</EmptyHeader>
					</Empty>
				}
				error={invitesQuery.isError}
				noResults={
					invites.filtered ? undefined : (
						<Empty
							art={<MascotArt mood="invites-empty" size="compact" />}
							reason="no-results"
							size="sm"
							variant="plain"
						>
							<EmptyHeader>
								<EmptyTitle>No active invite links</EmptyTitle>
							</EmptyHeader>
						</Empty>
					)
				}
				onRetry={async () => {
					await invitesQuery.refetch({ throwOnError: true });
				}}
				skeleton={<InviteRowsSkeleton />}
			>
				{(rows) => (
					<SettingsCard>
						<ItemGroup aria-label="Invite links">
							{rows.map((invite) => (
								<InviteLinkRow invite={invite} key={invite.id} org={org} />
							))}
						</ItemGroup>
					</SettingsCard>
				)}
			</Collection>
		</SettingsSection>
	);
}

function InviteForm({
	org,
	onCreated,
}: {
	org: string;
	onCreated: (token: string) => void;
}) {
	const queryClient = useQueryClient();
	const formId = useId();
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
				toast.fail(
					result.error ??
						"Tripwire couldn't create the invite link. Try again.",
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
		<>
			<DialogBody>
				<form
					className="flex flex-col"
					data-layout-role="invite-dialog-form"
					id={formId}
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
							items={ROLE_ITEMS}
							onValueChange={(value) => {
								if (isOrgRole(value)) {
									setRole(value);
								}
							}}
							value={role}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ROLE_ITEMS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field invalid={!maxUsesValid}>
						<FieldLabel>Use limit</FieldLabel>
						<NumberInput
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
							max={90}
							min={1}
							onValueChange={(value) => setExpiresInDays(value ?? 0)}
							unit="days"
							value={expiresInDays}
						/>
						{expiryValid ? null : <FieldError>Enter 1 to 90 days.</FieldError>}
					</Field>
				</form>
			</DialogBody>
			<DialogFooter>
				<DialogClose>Cancel</DialogClose>
				<DialogAction
					close={false}
					disabled={!inputsValid}
					form={formId}
					pending={createMutation.isPending}
					pendingLabel="Creating"
					type="submit"
				>
					Create invite link
				</DialogAction>
			</DialogFooter>
		</>
	);
}

function FreshInviteLink({ token }: { token: string }) {
	const url = `${window.location.origin}/invite/${token}`;
	return (
		<Field>
			<FieldLabel>New invite link, shown once</FieldLabel>
			<Input mode="copy" noun="invite link" value={url} />
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
			toast.success("Invite link revoked");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.invites(org) });
		},
	});

	const revoked = invite.revokedAt !== null;

	return (
		<CollectionRow
			actions={
				<InviteRowActions>
					<Caption>
						{invite.uses} of {invite.maxUses} used
					</Caption>
					<Caption>
						{revoked ? "Revoked" : inviteExpiryLabel(invite.expiresAt)}
					</Caption>
					{revoked ? null : (
						<Button
							aria-label={`Revoke ${roleName} invite link`}
							confirmation={false}
							onClick={() => setConfirmRevoke(true)}
							size="sm"
							variant="destructive"
						>
							Revoke
						</Button>
					)}
				</InviteRowActions>
			}
			content={
				<ItemContent>
					<ItemTitle>{ROLE_LABEL[invite.role]} invite</ItemTitle>
				</ItemContent>
			}
			overlay={
				<ConfirmDeleteDialog
					actionLabel="Revoke"
					onConfirm={() => revokeMutation.mutateAsync()}
					onOpenChange={setConfirmRevoke}
					open={confirmRevoke}
					pendingLabel="Revoking"
					title="Revoke this invite link?"
				/>
			}
		/>
	);
}
