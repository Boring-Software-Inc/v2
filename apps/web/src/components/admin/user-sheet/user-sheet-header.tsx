import { useMutation } from "@tanstack/react-query";
import type { AccessStatus } from "@tripwire/contracts";
import { AgentBoundary } from "@tripwire/ui/agent-policy";
import { Avatar } from "@tripwire/ui/avatar";
import { Badge } from "@tripwire/ui/badge";
import { Button, IconButton } from "@tripwire/ui/button";
import { Check, Failed, Icon, More, Time } from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { notify } from "@tripwire/ui/toast";
import { Tooltip } from "@tripwire/ui/tooltip";
import { Subheading, SupportingText } from "@tripwire/ui/typography";
import { useState } from "react";
import { useAccessReview } from "#/components/admin/user-sheet/access-section";
import { useSignOutEverywhere } from "#/components/admin/user-sheet/account-section";
import {
	errorText,
	unwrapStaffAction,
	useStaffAction,
} from "#/components/admin/user-sheet/use-staff-action";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import {
	type AdminUserView,
	impersonateAdminUser,
	unbanAdminUser,
} from "#/lib/staff-users.functions";

interface AccessBadgeSpec {
	tone: "success" | "warning" | "danger";
	label: string;
	glyph: typeof Check;
}

const ACCESS_BADGE = {
	approved: { tone: "success", label: "Approved", glyph: Check },
	pending: { tone: "warning", label: "Pending", glyph: Time },
	rejected: { tone: "danger", label: "Declined", glyph: Failed },
} satisfies Record<AccessStatus, AccessBadgeSpec>;

function AccessBadge({ status }: { status: AccessStatus }) {
	const badge = ACCESS_BADGE[status];
	return (
		<Badge tone={badge.tone}>
			<Icon icon={badge.glyph} />
			{badge.label}
		</Badge>
	);
}

async function copy(value: string, label: string) {
	try {
		await navigator.clipboard.writeText(value);
		notify.show({ title: `Copied ${label}` }, "success");
	} catch {
		notify.show({ title: `Tripwire couldn't copy the ${label}.` }, "error");
	}
}

export function UserSheetHeader({
	view,
	onBan,
	onDelete,
}: {
	view: AdminUserView;
	onBan: () => void;
	onDelete: () => void;
}) {
	const { user } = view;
	const review = useAccessReview(user.id, user.name);
	const signOutAll = useSignOutEverywhere(user.id, user.name);
	const [signOutAllOpen, setSignOutAllOpen] = useState(false);
	const unban = useStaffAction<void>({
		userId: user.id,
		run: () => unbanAdminUser({ data: { userId: user.id } }),
		failure: `Tripwire couldn't unban ${user.name}.`,
		success: () => `Unbanned ${user.name}`,
	});
	const impersonate = useMutation({
		mutationFn: () =>
			unwrapStaffAction(impersonateAdminUser({ data: { userId: user.id } })),
		onSuccess: () => window.location.assign("/"),
		onError: (error) =>
			notify.show(
				{ title: errorText(error, `Tripwire couldn't view as ${user.name}.`) },
				"error",
			),
	});
	const pending = user.accessStatus === "pending";
	const self = view.viewerId === user.id;
	const guarded = self || user.isPlatformAdmin;
	const menuItems: MenuEntry[] = [
		{
			label: "Copy user id",
			onAction: () => copy(user.id, "user id"),
			value: "copy-user-id",
		},
		{
			label: "Copy email",
			onAction: () => copy(user.email, "email"),
			value: "copy-email",
		},
		{ type: "separator", value: "account-actions-separator" },
		{
			disabled: self || view.sessions.length === 0,
			label: "Sign out everywhere",
			onAction: () => setSignOutAllOpen(true),
			value: "sign-out-everywhere",
		},
		user.banned
			? {
					label: "Unban",
					onAction: () => unban.mutate(),
					value: "unban",
				}
			: {
					disabled: guarded,
					label: "Ban",
					onAction: onBan,
					value: "ban",
				},
		{
			disabled: guarded,
			label: "Delete account",
			onAction: onDelete,
			value: "delete-account",
		},
	];
	const impersonateButton = (
		<AgentBoundary visibility="hidden">
			<Button
				data-layout-role="user-sheet-leading-action"
				disabled={!view.impersonation.ok || impersonate.isPending}
				onAction={() => impersonate.mutate()}
				pending={impersonate.isPending}
				pendingLabel="Starting"
				size="small"
				variant="secondary"
			>
				Impersonate
			</Button>
		</AgentBoundary>
	);
	return (
		<>
			<header data-layout-role="user-sheet-header">
				<div data-layout-role="user-sheet-identity">
					<Avatar
						decorative
						name={user.name}
						size="lg"
						src={user.image ?? undefined}
					/>
					<div data-layout-role="user-sheet-identity-copy">
						<div data-layout-role="user-sheet-title-row">
							<Subheading>{user.name}</Subheading>
							<AccessBadge status={user.accessStatus} />
							{user.banned ? <Badge tone="danger">Banned</Badge> : null}
							{user.isPlatformAdmin ? (
								<Badge variant="outline">Staff</Badge>
							) : null}
						</div>
						<div data-layout-role="user-sheet-contact">
							{user.login ? (
								<SupportingText as="span">{user.login}</SupportingText>
							) : null}
							<SupportingText as="span">{user.email}</SupportingText>
						</div>
					</div>
				</div>
				<div data-layout-role="user-sheet-header-actions">
					{pending ? (
						<AgentBoundary visibility="hidden">
							<Button
								data-layout-role="user-sheet-leading-action"
								disabled={review.isPending}
								onAction={() => review.mutate("reject")}
								size="small"
								variant="secondary"
							>
								Decline
							</Button>
							<Button
								data-layout-role="user-sheet-leading-action"
								disabled={review.isPending}
								onAction={() => review.mutate("approve")}
								size="small"
								variant="primary"
							>
								Approve
							</Button>
						</AgentBoundary>
					) : view.impersonation.ok ? (
						impersonateButton
					) : (
						<Tooltip
							trigger={
								<span data-layout-role="user-sheet-action-tooltip">
									{impersonateButton}
								</span>
							}
						>
							{view.impersonation.reason}
						</Tooltip>
					)}
					<Menu
						align="end"
						ariaLabel={`More actions for ${user.name}`}
						items={menuItems}
						trigger={
							<IconButton
								icon={<Icon icon={More} />}
								label={`More actions for ${user.name}`}
								size="small"
								variant="secondary"
							/>
						}
					/>
				</div>
			</header>
			<ConfirmDestructiveDialog
				confirmLabel="Sign out everywhere"
				description={`This ends all ${view.sessions.length} active sessions for ${user.name}.`}
				onConfirm={() => signOutAll.mutateAsync()}
				onOpenChange={setSignOutAllOpen}
				open={signOutAllOpen}
				pendingLabel="Signing out"
				title={`Sign ${user.name} out everywhere?`}
			/>
		</>
	);
}
