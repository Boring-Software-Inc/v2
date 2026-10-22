import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { useState } from "react";
import { Collection } from "#/components/collection/collection";
import { MetaRow } from "#/components/common/meta-row";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Dialog,
	DialogAction,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/glaze/ui/field";
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
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	INVITES_COLLECTION,
	MEMBERS_COLLECTION,
} from "#/components/organizations/org-members-collection";
import { useCollection } from "#/hooks/use-collection";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { formatRelativeTime } from "#/lib/format-relative-time";
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
} from "#/lib/org.query";

const ROLE_ITEMS = [
	{ value: "member", label: "Member" },
	{ value: "admin", label: "Admin" },
];

const ROLE_LABEL = {
	admin: "Admin",
	member: "Member",
} satisfies Record<OrgRole, string>;

function isOrgRole(value: string | null): value is OrgRole {
	return value === "admin" || value === "member";
}

function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	actionLabel,
	pendingLabel,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	actionLabel: string;
	pendingLabel: string;
	onConfirm: () => Promise<unknown>;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open} role="alertdialog">
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					<DialogAction
						onAction={onConfirm}
						pendingLabel={pendingLabel}
						variant="destructive"
					>
						{actionLabel}
					</DialogAction>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function OrgMembersPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const membersQuery = useQuery(orgMembersQueryOptions(org));
	const members = useCollection(MEMBERS_COLLECTION, membersQuery.data, {
		store: "local",
	});
	const { data: session } = useQuery(sessionInfoQueryOptions());

	const isAdmin = orgContext?.role === "admin";
	const isPersonal = orgContext?.isPersonal ?? true;
	const callerUserId = session?.user?.id ?? null;

	return (
		<div className="flex flex-col gap-8">
			<section
				aria-labelledby="org-members-heading"
				className="flex flex-col gap-3"
			>
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-0.5">
						<h3 className="type-heading-sm" id="org-members-heading">
							Members
						</h3>
						<p className="type-body-sm text-text-2">
							{isAdmin
								? "Who's in this org. Admins can change settings and members."
								: "Who's in this org. Only admins can change roles."}
						</p>
					</div>
					{isPersonal ? null : <LeaveOrgButton org={org} />}
				</div>
				<Collection
					collection={members}
					empty={null}
					error={membersQuery.isError}
					onRetry={async () => {
						await membersQuery.refetch({ throwOnError: true });
					}}
					skeleton={<MemberRowsSkeleton />}
					variant="plain"
				>
					{(rows) => (
						<ItemGroup variant="plain" aria-label="Members">
							{rows.map((member) => (
								<MemberRow
									callerUserId={callerUserId}
									isAdmin={isAdmin}
									key={member.memberId}
									member={member}
									org={org}
								/>
							))}
						</ItemGroup>
					)}
				</Collection>
			</section>

			{isAdmin && !isPersonal ? <InviteLinksSection org={org} /> : null}
		</div>
	);
}

function MemberRow({
	org,
	member,
	isAdmin,
	callerUserId,
}: {
	org: string;
	member: OrgMemberView;
	isAdmin: boolean;
	callerUserId: string | null;
}) {
	const queryClient = useQueryClient();
	const isSelf = callerUserId !== null && member.userId === callerUserId;

	const [confirmRemove, setConfirmRemove] = useState(false);

	const roleMutation = useMutation({
		mutationFn: (role: OrgRole) =>
			updateOrgMemberRole({ data: { org, memberId: member.memberId, role } }),
		onSuccess: (result, role) => {
			if (!result.ok) {
				toast.fail(
					result.error ??
						`Tripwire couldn't change the role for ${member.name}. Try again.`,
				);
				return;
			}
			toast.success(`${member.name} is now ${ROLE_LABEL[role].toLowerCase()}`);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
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

	return (
		<Item className="flex-wrap">
			<ItemMedia>
				<Avatar decorative name={member.name} src={member.image ?? undefined} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span>{member.name}</span>
					{isSelf ? <Badge size="sm">You</Badge> : null}
				</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>{member.email}</span>
						<span>Joined {formatRelativeTime(member.joinedAt)}</span>
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			{isAdmin && !isSelf ? (
				<ItemActions className="gap-2 @max-sm/item:ms-10 @max-sm/item:me-0 @max-sm/item:basis-full">
					<Select
						disabled={roleMutation.isPending}
						items={ROLE_ITEMS}
						onValueChange={(value) => {
							if (isOrgRole(value)) {
								roleMutation.mutate(value);
							}
						}}
						value={member.role}
					>
						<SelectTrigger
							aria-label={`Role for ${member.name}`}
							className="w-24"
							size="sm"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							{ROLE_ITEMS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						aria-label={`Remove ${member.name}`}
						onClick={() => setConfirmRemove(true)}
						size="sm"
						variant="secondary"
					>
						Remove
					</Button>
					<ConfirmDialog
						actionLabel="Remove member"
						description={`${member.name} loses access to this org and its repos. You can invite them again later.`}
						onConfirm={() => removeMutation.mutateAsync()}
						onOpenChange={setConfirmRemove}
						open={confirmRemove}
						pendingLabel="Removing"
						title={`Remove ${member.name}?`}
					/>
				</ItemActions>
			) : (
				<ItemActions>
					<Badge variant="outline">{ROLE_LABEL[member.role]}</Badge>
				</ItemActions>
			)}
		</Item>
	);
}

function LeaveOrgButton({ org }: { org: string }) {
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
		<>
			<Button onClick={() => setOpen(true)} size="sm" variant="secondary">
				Leave org
			</Button>
			<ConfirmDialog
				actionLabel="Leave org"
				description="You lose access to this org and its repos. An admin has to invite you to come back."
				onConfirm={() => leaveMutation.mutateAsync()}
				onOpenChange={setOpen}
				open={open}
				pendingLabel="Leaving"
				title="Leave this org?"
			/>
		</>
	);
}

function InviteLinksSection({ org }: { org: string }) {
	const queryClient = useQueryClient();
	const invitesQuery = useQuery(orgInvitesQueryOptions(org));
	const invites = useCollection(INVITES_COLLECTION, invitesQuery.data, {
		params: { status: "invites" },
	});

	const [role, setRole] = useState<OrgRole>("member");
	const [maxUses, setMaxUses] = useState(1);
	const [expiresInDays, setExpiresInDays] = useState(7);
	const [createdToken, setCreatedToken] = useState<string | null>(null);

	const createMutation = useMutation({
		mutationFn: () =>
			createOrgInvite({ data: { org, role, maxUses, expiresInDays } }),
		onSuccess: (result) => {
			if (result.token) {
				setCreatedToken(result.token);
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
		<section
			aria-labelledby="org-invites-heading"
			className="flex flex-col gap-3"
		>
			<div className="flex flex-col gap-0.5">
				<h3 className="type-heading-sm" id="org-invites-heading">
					Invite links
				</h3>
				<p className="type-body-sm text-text-2">
					Create a link and send it to people you trust. Each link has a use
					limit and an expiry date.
				</p>
			</div>
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(e) => {
					e.preventDefault();
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
				<Button
					disabled={!inputsValid}
					pending={createMutation.isPending}
					pendingLabel="Creating"
					type="submit"
				>
					Create invite link
				</Button>
			</form>

			{createdToken ? <FreshInviteLink token={createdToken} /> : null}

			<Collection
				collection={invites}
				empty={
					<InviteLinksEmpty
						creating={createMutation.isPending}
						onCreate={inputsValid ? () => createMutation.mutate() : undefined}
					/>
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
				variant="plain"
			>
				{(rows) => (
					<ItemGroup variant="plain" aria-label="Invite links">
						{rows.map((invite) => (
							<InviteLinkRow invite={invite} key={invite.id} org={org} />
						))}
					</ItemGroup>
				)}
			</Collection>
		</section>
	);
}

function FreshInviteLink({ token }: { token: string }) {
	const url = `${window.location.origin}/invite/${token}`;
	return (
		<Field>
			<FieldLabel>New invite link</FieldLabel>
			<Input mode="copy" noun="invite link" value={url} />
			<FieldDescription>
				Copy this link now. Tripwire shows it only once.
			</FieldDescription>
		</Field>
	);
}

function InviteLinksEmpty({
	creating,
	onCreate,
}: {
	creating: boolean;
	onCreate?: () => void;
}) {
	return (
		<Empty
			art={<MascotArt mood="invites-empty" size="compact" />}
			size="sm"
			variant="plain"
		>
			<EmptyHeader>
				<EmptyTitle>No invite links yet</EmptyTitle>
				<EmptyDescription>
					Create a link to add people to this org.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button
					disabled={!onCreate}
					onClick={onCreate}
					pending={creating}
					pendingLabel="Creating"
					size="sm"
					variant="secondary"
				>
					Create invite link
				</Button>
			</EmptyContent>
		</Empty>
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
	const expiresAt = new Date(invite.expiresAt);
	const expired = expiresAt.getTime() < Date.now();

	return (
		<Item>
			<ItemContent>
				<ItemTitle>
					<span>{ROLE_LABEL[invite.role]} invite</span>
				</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>
							<span className="tabular-nums">
								{invite.uses}/{invite.maxUses}
							</span>{" "}
							uses
						</span>
						<span>
							{expired ? "Expired" : "Expires"} {expiresAt.toLocaleDateString()}
						</span>
						{revoked ? <span>Revoked</span> : null}
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				{revoked ? (
					<Badge>Revoked</Badge>
				) : (
					<>
						<Button
							aria-label={`Revoke ${roleName} invite link`}
							onClick={() => setConfirmRevoke(true)}
							size="sm"
							variant="secondary"
						>
							Revoke
						</Button>
						<ConfirmDialog
							actionLabel="Revoke link"
							description="Nobody can join with this link after you revoke it. People who already joined stay in the org."
							onConfirm={() => revokeMutation.mutateAsync()}
							onOpenChange={setConfirmRevoke}
							open={confirmRevoke}
							pendingLabel="Revoking"
							title={`Revoke this ${roleName} invite link?`}
						/>
					</>
				)}
			</ItemActions>
		</Item>
	);
}

const ROW_SLOTS = ["a", "b", "c"] as const;

function MemberRowsSkeleton() {
	return (
		<ItemGroup variant="plain" aria-hidden>
			{ROW_SLOTS.map((slot) => (
				<Item key={slot}>
					<ItemMedia>
						<Skeleton className="size-6 rounded-pill" />
					</ItemMedia>
					<ItemContent>
						<SkeletonText className="w-32" type="label" />
						<SkeletonText className="w-56" type="body-sm" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

function InviteRowsSkeleton() {
	return (
		<ItemGroup variant="plain" aria-hidden>
			{ROW_SLOTS.slice(0, 2).map((slot) => (
				<Item key={slot}>
					<ItemContent>
						<SkeletonText className="w-28" type="label" />
						<SkeletonText className="w-44" type="body-sm" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

export function OrgMembersPageSkeleton() {
	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<SkeletonText className="w-24" type="heading-sm" />
					<SkeletonText className="w-64" type="body-sm" />
				</div>
				<MemberRowsSkeleton />
			</div>
		</div>
	);
}
