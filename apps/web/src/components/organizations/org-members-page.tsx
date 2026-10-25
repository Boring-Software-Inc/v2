import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { useState } from "react";
import { Collection } from "#/components/collection/collection";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { Icon, More } from "#/components/glaze/icon";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { Field, FieldError, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { NumberInput } from "#/components/glaze/ui/number-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import {
	INVITES_COLLECTION,
	MEMBERS_COLLECTION,
} from "#/components/organizations/org-members-collection";
import {
	SettingsCard,
	SettingsHeader,
	SettingsSection,
} from "#/components/settings/settings-frame";
import { useCollection } from "#/hooks/use-collection";
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
	const [inviting, setInviting] = useState(false);
	const [createdToken, setCreatedToken] = useState<string | null>(null);

	return (
		<>
			<SettingsHeader title="Members">
				{canInvite ? (
					<Button aria-expanded={inviting} onClick={() => setInviting(true)}>
						Invite
					</Button>
				) : null}
			</SettingsHeader>
			{canInvite && inviting ? (
				<InviteForm
					onCancel={() => setInviting(false)}
					onCreated={(token) => {
						setCreatedToken(token);
						setInviting(false);
					}}
					org={org}
				/>
			) : null}
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

			{isPersonal || !orgContext ? null : (
				<LeaveOrgRow name={orgContext.name} org={org} />
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
		<Item className="flex-wrap">
			<ItemMedia>
				<Avatar
					decorative
					name={member.name}
					size="lg"
					src={member.image ?? undefined}
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{member.name}</ItemTitle>
				<ItemDescription>{member.email}</ItemDescription>
			</ItemContent>
			<ItemActions className="gap-3 @max-sm/item:ms-11 @max-sm/item:me-0 @max-sm/item:basis-full">
				{isSelf ? <span className="type-body-sm text-text-2">You</span> : null}
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
						<SelectTrigger
							aria-label={`Role for ${member.name}`}
							className="w-28"
							size="sm"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							{roleItems.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<span className="type-body-sm text-text-2">
						{roleLabel(member.role)}
					</span>
				)}
				{isAdmin ? (
					<span className="flex size-(--control-sm) items-center justify-center">
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
									<DropdownMenuItem onClick={() => setConfirmRemove(true)}>
										Remove
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</span>
				) : null}
			</ItemActions>
			<ConfirmDeleteDialog
				actionLabel="Remove"
				onConfirm={() => removeMutation.mutateAsync()}
				onOpenChange={setConfirmRemove}
				open={confirmRemove}
				pendingLabel="Removing"
				title={`Remove ${member.name}?`}
			/>
		</Item>
	);
}

function LeaveOrgRow({ org, name }: { org: string; name: string }) {
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
		<div className="flex items-center justify-between gap-3 border-line-faint border-t pt-4">
			<p className="min-w-0 truncate type-label">Leave {name}</p>
			<Button onClick={() => setOpen(true)} size="sm" variant="secondary">
				Leave org
			</Button>
			<ConfirmDeleteDialog
				actionLabel="Leave org"
				description="An admin has to invite you back."
				onConfirm={() => leaveMutation.mutateAsync()}
				onOpenChange={setOpen}
				open={open}
				pendingLabel="Leaving"
				title={`Leave ${name}?`}
			/>
		</div>
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
					<Empty size="sm" variant="plain">
						<EmptyHeader>
							<EmptyTitle>No invite links yet</EmptyTitle>
						</EmptyHeader>
					</Empty>
				}
				error={invitesQuery.isError}
				noResults={
					invites.filtered ? undefined : (
						<Empty reason="no-results" size="sm" variant="plain">
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
	onCancel,
}: {
	org: string;
	onCreated: (token: string) => void;
	onCancel: () => void;
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
		<SettingsCard>
			<form
				aria-label="New invite link"
				className="panel flex flex-wrap items-start gap-3 p-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (inputsValid) {
						createMutation.mutate();
					}
				}}
			>
				<Field className="w-32">
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
				<Field className="w-32" invalid={!maxUsesValid}>
					<FieldLabel>Use limit</FieldLabel>
					<NumberInput
						max={1000}
						min={1}
						onValueChange={(value) => setMaxUses(value ?? 0)}
						value={maxUses}
					/>
					{maxUsesValid ? null : <FieldError>Enter 1 to 1000.</FieldError>}
				</Field>
				<Field className="w-32" invalid={!expiryValid}>
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
				<div className="ms-auto flex items-center gap-2 self-end">
					<Button onClick={onCancel} type="button" variant="secondary">
						Cancel
					</Button>
					<Button
						disabled={!inputsValid}
						pending={createMutation.isPending}
						pendingLabel="Creating"
						type="submit"
					>
						Create invite link
					</Button>
				</div>
			</form>
		</SettingsCard>
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
		<Item className="flex-wrap">
			<ItemContent>
				<ItemTitle>{ROLE_LABEL[invite.role]} invite</ItemTitle>
			</ItemContent>
			<ItemActions className="gap-6 @max-sm/item:me-0 @max-sm/item:basis-full">
				<span className="type-body-sm text-text-2 tabular-nums">
					{invite.uses} of {invite.maxUses} used
				</span>
				<span className="type-body-sm text-text-2">
					{revoked ? "Revoked" : inviteExpiryLabel(invite.expiresAt)}
				</span>
				{revoked ? null : (
					<Button
						aria-label={`Revoke ${roleName} invite link`}
						onClick={() => setConfirmRevoke(true)}
						size="sm"
						variant="secondary"
					>
						Revoke
					</Button>
				)}
			</ItemActions>
			<ConfirmDeleteDialog
				actionLabel="Revoke"
				onConfirm={() => revokeMutation.mutateAsync()}
				onOpenChange={setConfirmRevoke}
				open={confirmRevoke}
				pendingLabel="Revoking"
				title="Revoke this invite link?"
			/>
		</Item>
	);
}

const ROW_SLOTS = ["a", "b", "c"] as const;

function MemberRowsSkeleton() {
	return (
		<SettingsCard>
			<ItemGroup aria-hidden>
				{ROW_SLOTS.map((slot) => (
					<Item key={slot}>
						<ItemMedia>
							<Skeleton className="size-8 rounded-pill" />
						</ItemMedia>
						<ItemContent>
							<SkeletonText className="w-32" type="label" />
							<SkeletonText className="w-44" type="body-sm" />
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		</SettingsCard>
	);
}

function InviteRowsSkeleton() {
	return (
		<SettingsCard>
			<ItemGroup aria-hidden>
				{ROW_SLOTS.slice(0, 2).map((slot) => (
					<Item key={slot}>
						<ItemContent>
							<SkeletonText className="w-28" type="label" />
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		</SettingsCard>
	);
}
