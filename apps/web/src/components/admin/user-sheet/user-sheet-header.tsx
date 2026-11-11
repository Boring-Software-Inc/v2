import { useMutation } from "@tanstack/react-query";
import type { AccessStatus } from "@tripwire/contracts";
import { useState } from "react";
import { useAccessReview } from "#/components/admin/user-sheet/access-section";
import { useSignOutEverywhere } from "#/components/admin/user-sheet/account-section";
import {
	errorText,
	unwrapStaffAction,
	useStaffAction,
} from "#/components/admin/user-sheet/use-staff-action";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import { Check, Failed, Icon, More, Time } from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Badge } from "#/design-system/ui/badge";
import { Button } from "#/design-system/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/design-system/ui/dropdown-menu";
import { SheetTitle } from "#/design-system/ui/sheet";
import { toast } from "#/design-system/ui/toast";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";
import { SupportingText } from "#/design-system/ui/typography";
import {
	type AdminUserView,
	impersonateAdminUser,
	unbanAdminUser,
} from "#/lib/staff-users.functions";

interface AccessBadgeSpec {
	variant: "ok" | "warn" | "fail";
	label: string;
	glyph: typeof Check;
}

const ACCESS_BADGE = {
	approved: { variant: "ok", label: "Approved", glyph: Check },
	pending: { variant: "warn", label: "Pending", glyph: Time },
	rejected: { variant: "fail", label: "Declined", glyph: Failed },
} satisfies Record<AccessStatus, AccessBadgeSpec>;

function AccessBadge({ status }: { status: AccessStatus }) {
	const badge = ACCESS_BADGE[status];
	return (
		<Badge variant={badge.variant}>
			<Icon icon={badge.glyph} />
			{badge.label}
		</Badge>
	);
}

async function copy(value: string, label: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast.success(`Copied ${label}`);
	} catch {
		toast.fail(`Tripwire couldn't copy the ${label}.`);
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
			toast.fail(errorText(error, `Tripwire couldn't view as ${user.name}.`)),
	});
	const pending = user.accessStatus === "pending";
	const self = view.viewerId === user.id;
	const guarded = self || user.isPlatformAdmin;
	const impersonateButton = (
		<Button
			data-layout-role="user-sheet-leading-action"
			disabled={!view.impersonation.ok || impersonate.isPending}
			onClick={() => impersonate.mutate()}
			pending={impersonate.isPending}
			pendingLabel="Starting"
			size="sm"
			variant="secondary"
		>
			Impersonate
		</Button>
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
							<SheetTitle>{user.name}</SheetTitle>
							<AccessBadge status={user.accessStatus} />
							{user.banned ? <Badge variant="fail">Banned</Badge> : null}
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
						<>
							<Button
								data-layout-role="user-sheet-leading-action"
								disabled={review.isPending}
								onClick={() => review.mutate("reject")}
								size="sm"
								variant="secondary"
							>
								Decline
							</Button>
							<Button
								data-layout-role="user-sheet-leading-action"
								disabled={review.isPending}
								onClick={() => review.mutate("approve")}
								size="sm"
							>
								Approve
							</Button>
						</>
					) : view.impersonation.ok ? (
						impersonateButton
					) : (
						<Tooltip>
							<TooltipTrigger
								render={<span data-layout-role="user-sheet-action-tooltip" />}
							>
								{impersonateButton}
							</TooltipTrigger>
							<TooltipContent>{view.impersonation.reason}</TooltipContent>
						</Tooltip>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label={`More actions for ${user.name}`}
									size="icon-sm"
									variant="secondary"
								/>
							}
						>
							<Icon icon={More} />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" size="sm">
							<DropdownMenuItem onClick={() => void copy(user.id, "user id")}>
								Copy user id
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => void copy(user.email, "email")}>
								Copy email
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={self || view.sessions.length === 0}
								onClick={() => setSignOutAllOpen(true)}
								variant="destructive"
							>
								Sign out everywhere
							</DropdownMenuItem>
							{user.banned ? (
								<DropdownMenuItem onClick={() => unban.mutate()}>
									Unban
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									disabled={guarded}
									onClick={onBan}
									variant="destructive"
								>
									Ban
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								disabled={guarded}
								onClick={onDelete}
								variant="destructive"
							>
								Delete account
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>
			<ConfirmDestructiveDialog
				actionLabel="Sign out everywhere"
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
