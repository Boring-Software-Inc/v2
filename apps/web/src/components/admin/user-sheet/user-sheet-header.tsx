import { useMutation } from "@tanstack/react-query";
import type { AccessStatus } from "@tripwire/contracts";
import { useAccessReview } from "#/components/admin/user-sheet/access-section";
import { useSignOutEverywhere } from "#/components/admin/user-sheet/account-section";
import {
	errorText,
	unwrapStaffAction,
	useStaffAction,
} from "#/components/admin/user-sheet/use-staff-action";
import { Check, Failed, Icon, More, Time } from "#/components/glaze/icon";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import { SheetTitle } from "#/components/glaze/ui/sheet";
import { toast } from "#/components/glaze/ui/toast";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/glaze/ui/tooltip";
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
			className="flex-1 sm:flex-none"
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
		<div className="flex flex-col gap-4 border-line-faint border-b px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
			<div className="flex min-w-0 items-center gap-3">
				<Avatar
					decorative
					name={user.name}
					size="lg"
					src={user.image ?? undefined}
				/>
				<div className="flex min-w-0 flex-col gap-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<SheetTitle className="type-heading-sm">{user.name}</SheetTitle>
						<AccessBadge status={user.accessStatus} />
						{user.banned ? <Badge variant="fail">Banned</Badge> : null}
						{user.isPlatformAdmin ? (
							<Badge variant="outline">Staff</Badge>
						) : null}
					</div>
					<div className="flex min-w-0 flex-col type-body-sm text-text-2 sm:flex-row sm:gap-3">
						{user.login ? <span className="truncate">{user.login}</span> : null}
						<span className="truncate">{user.email}</span>
					</div>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{pending ? (
					<>
						<Button
							className="flex-1 sm:flex-none"
							disabled={review.isPending}
							onClick={() => review.mutate("reject")}
							size="sm"
							variant="secondary"
						>
							Decline
						</Button>
						<Button
							className="flex-1 sm:flex-none"
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
							render={<span className="flex flex-1 sm:flex-none" />}
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
							onClick={() => signOutAll.mutate()}
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
		</div>
	);
}
