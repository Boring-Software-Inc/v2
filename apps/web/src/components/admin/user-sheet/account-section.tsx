import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { formatStaffDate } from "#/components/admin/user-sheet/format";
import {
	FieldRow,
	FieldRows,
	ListRow,
	ListRows,
	QuietLine,
	SheetSectionBlock,
	SubHeading,
} from "#/components/admin/user-sheet/sheet-parts";
import { useStaffAction } from "#/components/admin/user-sheet/use-staff-action";
import { ChevronRight, External, Icon } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogConfirmField,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import { RelativeTime } from "#/components/glaze/ui/relative-time";
import { Switch } from "#/components/glaze/ui/switch";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { setUserRerunCooldownExempt } from "#/lib/admin.functions";
import {
	type AdminUserView,
	revokeAdminUserAgent,
	revokeAdminUserSession,
	revokeAdminUserSessions,
	setAdminUserPlatformAdmin,
	setAdminUserTimezone,
} from "#/lib/staff-users.functions";
import { describeUserAgent } from "#/lib/user-agent";

export function useSignOutEverywhere(userId: string, name: string) {
	return useStaffAction<void>({
		userId,
		run: () => revokeAdminUserSessions({ data: { userId } }),
		failure: `Tripwire couldn't sign ${name} out.`,
		success: () => `Signed ${name} out everywhere`,
	});
}

function PlatformAdminRow({ view }: { view: AdminUserView }) {
	const { user } = view;
	const [open, setOpen] = useState(false);
	const confirmText = user.login ?? user.name;
	const granting = !user.isPlatformAdmin;
	const change = useStaffAction<string>({
		userId: user.id,
		run: (confirm) =>
			setAdminUserPlatformAdmin({
				data: { userId: user.id, isPlatformAdmin: granting, confirm },
			}),
		failure: "Tripwire couldn't change platform admin access.",
		success: () =>
			granting
				? `${confirmText} is a platform admin`
				: `${confirmText} is no longer a platform admin`,
		toastErrors: false,
	});
	const self = view.viewerId === user.id;
	return (
		<FieldRow label="Platform admin">
			<Switch
				aria-label={`Platform admin for ${user.name}`}
				checked={user.isPlatformAdmin}
				disabled={self}
				onCheckedChange={() => setOpen(true)}
				size="sm"
			/>
			<Dialog
				confirmText={confirmText}
				onOpenChange={setOpen}
				open={open}
				role="alertdialog"
			>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>
							{granting
								? `Make ${confirmText} a platform admin?`
								: `Remove ${confirmText} as a platform admin?`}
						</DialogTitle>
						<DialogDescription>
							{granting
								? "They can see and change every user, org and repo."
								: "They lose access to the staff pages."}
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<DialogConfirmField />
					</DialogBody>
					<DialogFooter>
						<DialogClose>Cancel</DialogClose>
						<DialogAction
							onAction={() => change.mutateAsync(confirmText)}
							pendingLabel="Saving"
							variant={granting ? "primary" : "destructive"}
						>
							{granting ? "Make admin" : "Remove admin"}
						</DialogAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</FieldRow>
	);
}

export function AccountSection({ view }: { view: AdminUserView }) {
	const { user } = view;
	const timezoneLabel = useId();
	const timezone = useStaffAction<string | null>({
		userId: user.id,
		run: (value) =>
			setAdminUserTimezone({ data: { userId: user.id, timezone: value } }),
		failure: "Tripwire couldn't change the timezone.",
	});
	const cooldown = useStaffAction<boolean>({
		userId: user.id,
		run: async (exempt) => {
			await setUserRerunCooldownExempt({ data: { userId: user.id, exempt } });
			return { ok: true };
		},
		failure: `Tripwire couldn't change the cooldown for ${user.name}.`,
	});
	const revokeSession = useStaffAction<string>({
		userId: user.id,
		run: (sessionId) =>
			revokeAdminUserSession({ data: { userId: user.id, sessionId } }),
		failure: "Tripwire couldn't end this session.",
	});
	const signOutAll = useSignOutEverywhere(user.id, user.name);
	const revokeAgent = useStaffAction<string>({
		userId: user.id,
		run: (clientId) =>
			revokeAdminUserAgent({ data: { userId: user.id, clientId } }),
		failure: "Tripwire couldn't revoke this agent.",
	});
	return (
		<SheetSectionBlock id="account" title="Account">
			<FieldRows>
				<FieldRow label={<span id={timezoneLabel}>Timezone</span>}>
					<div className="w-full sm:w-55">
						<TimezonePicker
							disabled={timezone.isPending}
							labelledBy={timezoneLabel}
							onChange={(next) => timezone.mutate(next)}
							unsetLabel="Not set"
							value={user.timezone}
						/>
					</div>
				</FieldRow>
				<FieldRow label="Skip re-run cooldown">
					<Switch
						aria-label={`Skip re-run cooldown for ${user.name}`}
						checked={user.rerunCooldownExempt}
						onCheckedChange={(exempt) => cooldown.mutate(exempt)}
						pending={cooldown.isPending}
						size="sm"
					/>
				</FieldRow>
				<PlatformAdminRow view={view} />
			</FieldRows>

			<div className="flex flex-col pt-2">
				<SubHeading
					action={
						view.sessions.length > 0 ? (
							<Button
								disabled={signOutAll.isPending || view.viewerId === user.id}
								onClick={() => signOutAll.mutate()}
								size="sm"
								variant="secondary"
							>
								Sign out everywhere
							</Button>
						) : undefined
					}
					title="Sessions"
				/>
				{view.sessions.length === 0 ? (
					<QuietLine>No active sessions.</QuietLine>
				) : (
					<ListRows label="Sessions">
						{view.sessions.map((entry) => (
							<ListRow key={entry.id}>
								<span className="flex min-w-0 flex-1 items-center gap-2 text-text-1">
									<span className="truncate">
										{describeUserAgent(entry.userAgent)}
									</span>
									{entry.impersonatedBy ? (
										<Badge size="sm" variant="warn">
											Impersonation
										</Badge>
									) : null}
								</span>
								<span className="text-text-2 sm:w-30 sm:shrink-0">
									{entry.ipAddress ?? "No IP"}
								</span>
								<span className="text-text-2 sm:w-30 sm:shrink-0">
									<RelativeTime date={entry.updatedAt} />
								</span>
								<span className="flex justify-end sm:w-20 sm:shrink-0">
									<Button
										aria-label={`Sign out ${describeUserAgent(entry.userAgent)}`}
										disabled={revokeSession.isPending}
										onClick={() => revokeSession.mutate(entry.id)}
										size="sm"
										variant="secondary"
									>
										Sign out
									</Button>
								</span>
							</ListRow>
						))}
					</ListRows>
				)}
			</div>

			<div className="flex flex-col pt-2">
				<SubHeading title="Connected agents" />
				{view.agents.length === 0 ? (
					<QuietLine>No connected agents.</QuietLine>
				) : (
					<ListRows label="Connected agents">
						{view.agents.map((agent) => (
							<ListRow key={agent.clientId}>
								<span className="min-w-0 flex-1 truncate text-text-1">
									{agent.name}
								</span>
								<span className="truncate text-text-2 sm:w-30 sm:shrink-0">
									{agent.orgs.length === 1
										? agent.orgs[0]?.slug
										: `${agent.orgs.length} orgs`}
								</span>
								<span className="text-text-2 sm:w-30 sm:shrink-0">
									{agent.lastUsedAt ? (
										<RelativeTime date={agent.lastUsedAt} />
									) : (
										"Not used yet"
									)}
								</span>
								<span className="flex justify-end sm:w-20 sm:shrink-0">
									<Button
										aria-label={`Revoke ${agent.name}`}
										disabled={revokeAgent.isPending}
										onClick={() => revokeAgent.mutate(agent.clientId)}
										size="sm"
										variant="secondary"
									>
										Revoke
									</Button>
								</span>
							</ListRow>
						))}
					</ListRows>
				)}
			</div>

			<div className="flex flex-col pt-2">
				<SubHeading title="Forge identities" />
				{view.forgeIdentities.length === 0 ? (
					<QuietLine>No forge identities.</QuietLine>
				) : (
					<ListRows label="Forge identities">
						{view.forgeIdentities.map((identity) => (
							<ListRow key={`${identity.forge}:${identity.externalId}`}>
								<span className="min-w-0 flex-1 text-text-1">
									{identity.forge === "github" ? "GitHub" : identity.forge}
								</span>
								<span className="truncate text-text-2 sm:w-30 sm:shrink-0">
									{identity.username}
								</span>
								<span className="text-text-2 sm:w-30 sm:shrink-0">
									Linked {formatStaffDate(identity.createdAt)}
								</span>
								<span className="flex justify-end sm:w-20 sm:shrink-0">
									{identity.forge === "github" ? (
										<a
											aria-label={`Open ${identity.username} on GitHub`}
											className="inline-flex size-8 items-center justify-center rounded-pill text-text-2 hover:bg-hover focus-visible:focus-ring"
											href={`https://github.com/${identity.username}`}
											rel="noreferrer"
											target="_blank"
										>
											<Icon icon={External} />
										</a>
									) : null}
								</span>
							</ListRow>
						))}
					</ListRows>
				)}
			</div>

			<div className="flex flex-col pt-2">
				<SubHeading title="Orgs" />
				{view.orgs.length === 0 ? (
					<QuietLine>Not in any org.</QuietLine>
				) : (
					<ListRows label="Orgs">
						{view.orgs.map((org) => (
							<ListRow key={org.id}>
								<span className="min-w-0 flex-1 truncate text-text-1">
									{org.name}
								</span>
								<span className="truncate text-text-2 sm:w-30 sm:shrink-0">
									{org.slug}
								</span>
								<span className="text-text-1 sm:w-30 sm:shrink-0">
									{org.isPersonal
										? "Personal"
										: org.role === "admin"
											? "Admin"
											: org.role === "member"
												? "Member"
												: org.role}
								</span>
								<span className="flex justify-end sm:w-20 sm:shrink-0">
									<Link
										aria-label={`Open ${org.name} in staff orgs`}
										className="inline-flex size-8 items-center justify-center rounded-pill text-text-2 hover:bg-hover focus-visible:focus-ring"
										to="/admin/orgs"
									>
										<Icon icon={ChevronRight} />
									</Link>
								</span>
							</ListRow>
						))}
					</ListRows>
				)}
			</div>
		</SheetSectionBlock>
	);
}
