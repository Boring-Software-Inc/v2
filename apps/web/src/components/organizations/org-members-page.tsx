import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@tripwire/contracts";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { toast } from "#/components/ui/toast";
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

const ROLE_SELECT_CLASS =
	"h-7 rounded-md border bg-card px-2 text-foreground text-xs disabled:cursor-not-allowed disabled:opacity-50";

export function OrgMembersPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const { data: members } = useQuery(orgMembersQueryOptions(org));
	const { data: session } = useQuery(sessionInfoQueryOptions());

	const isAdmin = orgContext?.role === "admin";
	const isPersonal = orgContext?.isPersonal ?? true;
	const callerUserId = session?.user?.id ?? null;

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader className="flex-row items-start justify-between">
					<div className="flex flex-col gap-1.5">
						<CardTitle>members</CardTitle>
						<CardDescription>
							{isAdmin
								? "who's in this org and what they can touch."
								: "who's in this org. only admins can change roles."}
						</CardDescription>
					</div>
					{!isPersonal && <LeaveOrgButton org={org} />}
				</CardHeader>
				<CardContent>
					<ul className="flex flex-col divide-y">
						{(members ?? []).map((member) => (
							<MemberRow
								callerUserId={callerUserId}
								isAdmin={isAdmin}
								key={member.memberId}
								member={member}
								org={org}
							/>
						))}
					</ul>
				</CardContent>
			</Card>

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
				toast(result.error ?? "role change refused");
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
				toast(result.error ?? "removal refused");
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
		},
	});

	return (
		<li className="flex items-center gap-3 py-3">
			<Avatar>
				{member.image ? (
					<AvatarImage alt={member.name} src={member.image} />
				) : null}
				<AvatarFallback className="text-xs">
					{member.name.slice(0, 2).toLowerCase()}
				</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="flex items-center gap-2 truncate font-medium text-sm">
					{member.name}
					{isSelf ? <Badge variant="secondary">you</Badge> : null}
				</p>
				<p className="truncate text-muted-foreground text-xs">
					{member.email} · joined {formatRelativeTime(member.joinedAt)}
				</p>
			</div>
			{isAdmin ? (
				<div className="flex shrink-0 items-center gap-2">
					<select
						aria-label={`role for ${member.name}`}
						className={ROLE_SELECT_CLASS}
						disabled={isSelf || roleMutation.isPending}
						onChange={(e) => roleMutation.mutate(e.target.value as OrgRole)}
						value={member.role}
					>
						<option value="admin">admin</option>
						<option value="member">member</option>
					</select>
					<Button
						disabled={isSelf || removeMutation.isPending}
						onClick={() => removeMutation.mutate()}
						size="xs"
						title={
							isSelf ? "you can't remove yourself — leave instead" : undefined
						}
						variant="outline"
					>
						remove
					</Button>
				</div>
			) : (
				<Badge variant="outline">{member.role}</Badge>
			)}
		</li>
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
			toast(result.error ?? "you're the last admin here");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.members(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() });
		},
	});

	return (
		<Button
			disabled={leaveMutation.isPending}
			onClick={() => leaveMutation.mutate()}
			size="xs"
			variant="outline"
		>
			leave org
		</Button>
	);
}

// ── invite links ─────────────────────────────────────────────────────────

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
				toast(result.error ?? "could not create invite");
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
		<Card>
			<CardHeader>
				<CardTitle>invite links</CardTitle>
				<CardDescription>
					mint a link, send it to whoever you trust. each link caps its uses and
					expires on its own.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<form
					className="flex flex-wrap items-end gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (inputsValid) {
							createMutation.mutate();
						}
					}}
				>
					<label className="flex flex-col gap-1 text-muted-foreground text-xs">
						role
						<select
							className="h-9 rounded-md border bg-card px-2 text-foreground text-sm"
							onChange={(e) => setRole(e.target.value as OrgRole)}
							value={role}
						>
							<option value="member">member</option>
							<option value="admin">admin</option>
						</select>
					</label>
					<label
						className="flex flex-col gap-1 text-muted-foreground text-xs"
						htmlFor="invite-max-uses"
					>
						max uses
						<Input
							className="w-24"
							id="invite-max-uses"
							max={1000}
							min={1}
							onChange={(e) => setMaxUses(Number(e.target.value))}
							type="number"
							value={maxUses}
						/>
					</label>
					<label
						className="flex flex-col gap-1 text-muted-foreground text-xs"
						htmlFor="invite-expires-days"
					>
						expires in days
						<Input
							className="w-24"
							id="invite-expires-days"
							max={90}
							min={1}
							onChange={(e) => setExpiresInDays(Number(e.target.value))}
							type="number"
							value={expiresInDays}
						/>
					</label>
					<Button
						disabled={!inputsValid || createMutation.isPending}
						size="sm"
						type="submit"
					>
						create invite link
					</Button>
				</form>

				{createdToken ? <FreshInviteLink token={createdToken} /> : null}

				<InviteLinkList invites={invites ?? []} org={org} />
			</CardContent>
		</Card>
	);
}

function FreshInviteLink({ token }: { token: string }) {
	const url = `${window.location.origin}/invite/${token}`;
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-dashed bg-card p-3">
			<div className="flex items-center gap-2">
				<Input className="font-mono text-xs" readOnly value={url} />
				<Button
					onClick={() => {
						navigator.clipboard.writeText(url);
						toast("invite link copied");
					}}
					size="sm"
					variant="secondary"
				>
					copy
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				this link is shown once — copy it now. only its hash is stored.
			</p>
		</div>
	);
}

function InviteLinkList({
	org,
	invites,
}: {
	org: string;
	invites: InviteLinkView[];
}) {
	if (invites.length === 0) {
		return (
			<p className="rounded-lg border border-dashed px-4 py-3 text-center text-muted-foreground text-xs">
				no invite links yet.
			</p>
		);
	}
	return (
		<ul className="flex flex-col divide-y">
			{invites.map((invite) => (
				<InviteLinkRow invite={invite} key={invite.id} org={org} />
			))}
		</ul>
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
		<li className="flex items-center gap-3 py-3">
			<Badge variant="outline">{invite.role}</Badge>
			<div className="min-w-0 flex-1 text-muted-foreground text-xs">
				{invite.uses}/{invite.maxUses} uses · {expired ? "expired" : "expires"}{" "}
				{expiresAt.toLocaleDateString()}
			</div>
			{revoked ? (
				<Badge variant="secondary">revoked</Badge>
			) : (
				<Button
					disabled={revokeMutation.isPending}
					onClick={() => revokeMutation.mutate()}
					size="xs"
					variant="outline"
				>
					revoke
				</Button>
			)}
		</li>
	);
}

export function OrgMembersPageSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="h-64 animate-pulse rounded-xl bg-surface-1" />
			<div className="h-48 animate-pulse rounded-xl bg-surface-1" />
		</div>
	);
}
