import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { useState } from "react";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyArt,
	EmptyContent,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	Field,
	FieldDescription,
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
import {
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
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

const ROLE_LABEL: Record<OrgRole, string> = {
	admin: "Admin",
	member: "Member",
};

function isOrgRole(value: string | null): value is OrgRole {
	return value === "admin" || value === "member";
}

export function OrgMembersPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const { data: members } = useQuery(orgMembersQueryOptions(org));
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
								? "Who's in this org and what they can touch."
								: "Who's in this org. Only admins can change roles."}
						</p>
					</div>
					{isPersonal ? null : <LeaveOrgButton org={org} />}
				</div>
				<SkeletonSwap
					fallback={<MemberRowsSkeleton />}
					label="Loading members"
					loading={!members}
				>
					<ItemGroup variant="plain" aria-label="Members">
						{(members ?? []).map((member) => (
							<MemberRow
								callerUserId={callerUserId}
								isAdmin={isAdmin}
								key={member.memberId}
								member={member}
								org={org}
							/>
						))}
					</ItemGroup>
				</SkeletonSwap>
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

	const roleMutation = useMutation({
		mutationFn: (role: OrgRole) =>
			updateOrgMemberRole({ data: { org, memberId: member.memberId, role } }),
		onSuccess: (result) => {
			if (!result.ok) {
				toast.fail(result.error ?? "Role change refused");
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
		},
	});

	const removeMutation = useMutation({
		mutationFn: () =>
			removeOrgMember({ data: { org, memberId: member.memberId } }),
		onSuccess: (result) => {
			if (!result.ok) {
				toast.fail(result.error ?? "Removal refused");
			}
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
				<ItemDescription className="truncate">
					{member.email} · joined {formatRelativeTime(member.joinedAt)}
				</ItemDescription>
			</ItemContent>
			{isAdmin ? (
				<ItemActions className="gap-2 @max-sm/item:ms-10 @max-sm/item:me-0 @max-sm/item:basis-full">
					<Select
						disabled={isSelf || roleMutation.isPending}
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
						disabled={isSelf}
						pending={removeMutation.isPending}
						pendingLabel="Removing"
						onClick={() => removeMutation.mutate()}
						size="sm"
						title={
							isSelf ? "You can't remove yourself. Leave instead." : undefined
						}
						variant="secondary"
					>
						Remove
					</Button>
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
	const leaveMutation = useMutation({
		mutationFn: () => leaveOrg({ data: { org } }),
		onSuccess: (result) => {
			if (result.ok) {
				// hard navigation — the org scope this page lives under is gone.
				window.location.assign("/");
				return;
			}
			toast.fail(result.error ?? "You're the last admin here");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() });
		},
	});

	return (
		<Button
			onClick={() => leaveMutation.mutate()}
			pending={leaveMutation.isPending}
			pendingLabel="Leaving"
			size="sm"
			variant="secondary"
		>
			Leave org
		</Button>
	);
}

function InviteLinksSection({ org }: { org: string }) {
	const queryClient = useQueryClient();
	const { data: invites } = useQuery(orgInvitesQueryOptions(org));

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
				toast.fail(result.error ?? "Could not create invite");
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.invites(org) });
		},
	});

	const inputsValid =
		maxUses >= 1 &&
		maxUses <= 1000 &&
		expiresInDays >= 1 &&
		expiresInDays <= 90;

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
				<Field className="w-32">
					<FieldLabel>Max uses</FieldLabel>
					<NumberInput
						max={1000}
						min={1}
						onValueChange={(value) => setMaxUses(value ?? 0)}
						value={maxUses}
					/>
				</Field>
				<Field className="w-32">
					<FieldLabel>Expires in</FieldLabel>
					<NumberInput
						max={90}
						min={1}
						onValueChange={(value) => setExpiresInDays(value ?? 0)}
						unit="days"
						value={expiresInDays}
					/>
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

			<SkeletonSwap
				fallback={<InviteRowsSkeleton />}
				label="Loading invite links"
				loading={!invites}
			>
				<InviteLinkList
					creating={createMutation.isPending}
					invites={invites ?? []}
					onCreate={inputsValid ? () => createMutation.mutate() : undefined}
					org={org}
				/>
			</SkeletonSwap>
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

function InviteLinkList({
	org,
	invites,
	creating,
	onCreate,
}: {
	org: string;
	invites: InviteLinkView[];
	creating: boolean;
	onCreate?: () => void;
}) {
	if (invites.length === 0) {
		return (
			<Empty art={<EmptyArt size="compact" />} size="sm" variant="plain">
				<EmptyHeader>
					<EmptyTitle>No invite links yet</EmptyTitle>
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
						Create link
					</Button>
				</EmptyContent>
			</Empty>
		);
	}
	return (
		<ItemGroup variant="plain" aria-label="Invite links">
			{invites.map((invite) => (
				<InviteLinkRow invite={invite} key={invite.id} org={org} />
			))}
		</ItemGroup>
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
	const revokeMutation = useMutation({
		mutationFn: () => revokeOrgInvite({ data: { org, inviteId: invite.id } }),
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
					<span className="tabular-nums">
						{invite.uses}/{invite.maxUses}
					</span>{" "}
					uses · {expired ? "expired" : "expires"}{" "}
					{expiresAt.toLocaleDateString()}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				{revoked ? (
					<Badge>Revoked</Badge>
				) : (
					<Button
						aria-label={`Revoke ${invite.role} invite`}
						onClick={() => revokeMutation.mutate()}
						pending={revokeMutation.isPending}
						pendingLabel="Revoking"
						size="sm"
						variant="secondary"
					>
						Revoke
					</Button>
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
