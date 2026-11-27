import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FORGE_BY_ID, type ForgeConnection } from "@tripwire/contracts";
import { Avatar } from "@tripwire/ui/avatar";
import { Badge } from "@tripwire/ui/badge";
import { Button, DestructiveDialogLauncher } from "@tripwire/ui/button";
import { ArrowRight, Check, Icon } from "@tripwire/ui/icon";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@tripwire/ui/item";
import { SkeletonSwap, SkeletonText } from "@tripwire/ui/skeleton";
import { Status } from "@tripwire/ui/status";
import { Switch } from "@tripwire/ui/switch";
import { notify } from "@tripwire/ui/toast";
import { SupportingText } from "@tripwire/ui/typography";
import { useEffect, useRef, useState } from "react";
import { DeleteAccountDialog } from "#/components/account/delete-account-dialog";
import { ThemePicker } from "#/components/account/theme-picker";
import {
	EmptyState,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	SettingsHeader,
	SettingsPanel,
	SettingsSection,
} from "#/components/settings/settings-frame";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { useOrgSwitchPath } from "#/hooks/use-org-switch-path";
import { useDeviceTimezone } from "#/hooks/use-timezones";
import {
	type AccountSession,
	revokeMyOtherSessions,
	revokeMySession,
} from "#/lib/account.functions";
import {
	accountQueryKeys,
	accountSessionsQueryOptions,
} from "#/lib/account.query";
import { setAgentMotion } from "#/lib/agent-motion.functions";
import type { CurrentUser } from "#/lib/auth.functions";
import { authQueryKeys, sessionInfoQueryOptions } from "#/lib/auth.query";
import { connectionsQueryOptions } from "#/lib/connections.query";
import { reconnectForge } from "#/lib/forge-connect";
import { myOrgsQueryOptions, orgContextQueryOptions } from "#/lib/org.query";
import { ACCOUNT_SECTIONS } from "#/lib/settings-sections";
import { setAccountTimezone } from "#/lib/timezone.functions";
import { describeUserAgent } from "#/lib/user-agent";

const ROLE_LABEL = new Map([
	["admin", "Admin"],
	["member", "Member"],
]);

const ROW_SLOTS = ["a", "b"] as const;

function forgeLabel(forge: string): string {
	return FORGE_BY_ID[forge as keyof typeof FORGE_BY_ID]?.label ?? forge;
}

function tokenExpired(connection: ForgeConnection): boolean {
	return (
		connection.accessTokenExpiresAt !== null &&
		!connection.canRefresh &&
		Date.parse(connection.accessTokenExpiresAt) <= Date.now()
	);
}

export function AccountPage({ org, user }: { org: string; user: CurrentUser }) {
	useEffect(() => {
		const hash = window.location.hash.slice(1);
		const section = ACCOUNT_SECTIONS.find((section) => section === hash);
		if (!section) return;
		const frame = requestAnimationFrame(() => {
			const target = document.getElementById(section);
			if (target?.closest("main")?.scrollTop === 0) {
				target.scrollIntoView({ behavior: "instant", block: "start" });
			}
		});
		return () => cancelAnimationFrame(frame);
	}, []);
	const { data: connections, isLoading: connectionsLoading } = useQuery(
		connectionsQueryOptions(),
	);
	const forges = new Set((connections ?? []).map((entry) => entry.forge));
	const sourceForge = forges.size === 1 ? ([...forges][0] ?? null) : null;

	return (
		<>
			<SettingsHeader
				description="Manage your profile, sign-in, preferences, and workspaces."
				title="Your account"
			/>
			<ProfileSection sourceForge={sourceForge} user={user} />
			<SignInSection
				connections={connections ?? []}
				loading={connectionsLoading}
				org={org}
				user={user}
			/>
			<SessionsSection />
			<PreferencesSection org={org} />
			<OrgsSection activeOrg={org} />
			<AccountDeletion />
		</>
	);
}

function ProfileSection({
	user,
	sourceForge,
}: {
	user: CurrentUser;
	sourceForge: ForgeConnection["forge"] | null;
}) {
	return (
		<SettingsSection id="profile" title="Profile">
			<div className="shell">
				<div className="panel flex items-center gap-3 p-4">
					<Avatar
						className="size-12"
						decorative
						name={user.name}
						size="lg"
						src={user.image || undefined}
					/>
					<div className="flex min-w-0 flex-1 flex-col">
						<p className="truncate type-label">{user.name}</p>
						<p className="truncate type-body-sm text-text-2">
							{user.email ?? `@${user.login}`}
						</p>
					</div>
					{sourceForge ? (
						<div className="flex shrink-0 items-center gap-2 type-body-sm text-text-2">
							<ForgeMark className="size-(--icon)" forge={sourceForge} />
							<span>{forgeLabel(sourceForge)} profile</span>
						</div>
					) : null}
				</div>
			</div>
		</SettingsSection>
	);
}

function SignInSection({
	org,
	user,
	connections,
	loading,
}: {
	org: string;
	user: CurrentUser;
	connections: ForgeConnection[];
	loading: boolean;
}) {
	return (
		<SettingsSection id="sign-in" title="Sign-in">
			<div className="shell">
				<ItemGroup aria-label="Sign-in">
					{loading ? (
						<Item aria-hidden>
							<ItemContent>
								<span data-skeleton-line="" aria-hidden className="w-32">
									<SkeletonText type="label" />
								</span>
							</ItemContent>
						</Item>
					) : (
						connections.map((connection) => (
							<SignInRow
								connection={connection}
								key={`${connection.forge}:${connection.accountId}`}
								login={connection.forge === "github" ? user.forgeLogin : null}
							/>
						))
					)}
					<Item>
						<ItemContent>
							<ItemTitle>App installs</ItemTitle>
						</ItemContent>
						<ItemActions>
							<Button
								href={`/${org}/settings/connections`}
								size="small"
								variant="secondary"
							>
								Open connections
								<Icon icon={ArrowRight} />
							</Button>
						</ItemActions>
					</Item>
				</ItemGroup>
			</div>
		</SettingsSection>
	);
}

function SignInRow({
	connection,
	login,
}: {
	connection: ForgeConnection;
	login: string | null;
}) {
	const label = forgeLabel(connection.forge);
	const expired = tokenExpired(connection);
	return (
		<Item>
			<ItemMedia variant="icon">
				<ForgeMark className="size-(--icon)" forge={connection.forge} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{login ? `@${login}` : label}</ItemTitle>
			</ItemContent>
			<ItemActions data-layout-role="account-sessions-actions">
				<Status size="small" status={expired ? "warn" : "ok"}>
					{expired ? "Access expired" : "Connected"}
				</Status>
				{expired ? (
					<Button
						ariaLabel={`Reconnect ${label}`}
						onAction={() => {
							void reconnectForge(connection.forge).then((message) => {
								if (message) {
									notify.show({ title: message }, "error");
								}
							});
						}}
						size="small"
						variant="secondary"
					>
						Reconnect
					</Button>
				) : null}
			</ItemActions>
		</Item>
	);
}

function SessionRow({ session }: { session: AccountSession }) {
	const queryClient = useQueryClient();
	const device = describeUserAgent(session.userAgent);
	const revoke = useMutation({
		mutationFn: () => revokeMySession({ data: { sessionId: session.id } }),
		onSuccess: () => notify.show({ title: `Signed out ${device}` }, "success"),
		onError: (error) => notify.show({ title: error.message }, "error"),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: accountQueryKeys.sessions() }),
	});
	return (
		<Item>
			<ItemContent>
				<ItemTitle>{device}</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>
							Signed in <ZonedTime at={session.createdAt} format="short" />
						</span>
						<span>
							Active <ZonedTime at={session.lastActiveAt} format="short" />
						</span>
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				{session.current ? (
					<span className="type-body-sm text-text-2">This device</span>
				) : (
					<Button
						ariaLabel={`Sign out ${device}`}
						confirmation={{
							confirmLabel: "Sign out device",
							description: `This ends the active Tripwire session on ${device}.`,
							title: `Sign out ${device}?`,
						}}
						onAction={() => revoke.mutateAsync()}
						size="small"
						variant="destructive"
					>
						Sign out
					</Button>
				)}
			</ItemActions>
		</Item>
	);
}

function SessionsSection() {
	const queryClient = useQueryClient();
	const { data: sessions, isLoading } = useQuery(accountSessionsQueryOptions());
	const others = sessions?.filter((session) => !session.current).length ?? 0;
	const revokeOthers = useMutation({
		mutationFn: () => revokeMyOtherSessions(),
		onSuccess: () =>
			notify.show({ title: "Signed out everywhere else" }, "success"),
		onError: (error) => notify.show({ title: error.message }, "error"),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: accountQueryKeys.sessions() }),
	});
	return (
		<SettingsSection
			action={
				others > 0 ? (
					<Button
						confirmation={{
							confirmLabel: "Sign out",
							description: `This keeps this device signed in and ends ${others} other ${others === 1 ? "session" : "sessions"}. You will need to sign in again on those devices.`,
							title: "Sign out everywhere else?",
						}}
						onAction={() => revokeOthers.mutateAsync()}
						pending={revokeOthers.isPending}
						pendingLabel="Signing out"
						size="small"
						variant="destructive"
					>
						Sign out everywhere else
					</Button>
				) : null
			}
			id="sessions"
			title="Sessions"
		>
			<SkeletonSwap
				fallback={<RowsSkeleton />}
				label="Loading sessions"
				loading={isLoading}
			>
				<div className="shell">
					{sessions?.length ? (
						<ItemGroup aria-label="Sessions">
							{sessions.map((session) => (
								<SessionRow key={session.id} session={session} />
							))}
						</ItemGroup>
					) : (
						<EmptyState size="sm" variant="plain">
							<EmptyStateHeader>
								<EmptyStateTitle>No active sessions</EmptyStateTitle>
								<EmptyStateDescription>
									Sessions appear here after you sign in on a device.
								</EmptyStateDescription>
							</EmptyStateHeader>
						</EmptyState>
					)}
				</div>
			</SkeletonSwap>
		</SettingsSection>
	);
}

function PreferencesSection({ org }: { org: string }) {
	const queryClient = useQueryClient();
	const device = useDeviceTimezone();
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const signedIn = Boolean(session?.user);
	const reduce = session?.user?.reduceAgentMotion ?? false;
	const saveMotion = useMutation({
		mutationFn: (next: boolean) => setAgentMotion({ data: { reduce: next } }),
		onError: () =>
			notify.show(
				{ title: "Tripwire could not save the setting. Try again." },
				"error",
			),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	const saveTimezone = useMutation({
		mutationFn: (next: string | null) =>
			setAccountTimezone({ data: { timezone: next } }),
		onSuccess: () => notify.show({ title: "Timezone saved" }, "success"),
		onError: () =>
			notify.show(
				{ title: "Tripwire could not save the timezone. Try again." },
				"error",
			),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	const checked = saveMotion.isPending
		? (saveMotion.variables ?? reduce)
		: reduce;
	return (
		<SettingsSection id="preferences" title="Preferences">
			<div className="flex flex-col gap-3">
				<ThemePicker reduceMotion={checked} />
				<div className="shell">
					<ItemGroup aria-label="Preferences">
						<Item>
							<ItemContent>
								<ItemTitle id="agent-motion-label">Reduce motion</ItemTitle>
							</ItemContent>
							<ItemActions>
								<Switch
									ariaLabelledBy="agent-motion-label"
									checked={checked}
									disabled={!signedIn}
									onCheckedChange={(next) => saveMotion.mutate(next)}
									pending={saveMotion.isPending}
								/>
							</ItemActions>
						</Item>
						<Item data-layout-role="account-timezone-row">
							<ItemContent>
								<ItemTitle id="timezone-label">Display timezone</ItemTitle>
							</ItemContent>
							<ItemActions data-layout-role="account-timezone-picker">
								<div className="w-full">
									<TimezonePicker
										disabled={!signedIn || saveTimezone.isPending}
										labelledBy="timezone-label"
										onChange={(next) => saveTimezone.mutate(next)}
										unsetLabel={
											orgContext?.timezone
												? `Use organization timezone (${orgContext.timezone})`
												: `Use device timezone (${device})`
										}
										value={session?.user?.timezone ?? null}
									/>
								</div>
							</ItemActions>
						</Item>
					</ItemGroup>
				</div>
			</div>
		</SettingsSection>
	);
}

function OrgsSection({ activeOrg }: { activeOrg: string }) {
	const { data: orgs, isLoading } = useQuery(myOrgsQueryOptions());
	const orgSwitchPath = useOrgSwitchPath();
	return (
		<SettingsSection
			description="Choose the workspace shown in the dashboard."
			id="orgs"
			title="Workspaces"
		>
			<SkeletonSwap
				fallback={<RowsSkeleton />}
				label="Loading orgs"
				loading={isLoading}
			>
				<div className="shell">
					<ItemGroup aria-label="Orgs">
						{(orgs ?? []).map((entry) => {
							const active = entry.slug === activeOrg;
							return (
								<Item key={entry.id} selected={active}>
									<ItemMedia>
										<OrgAvatar hue={entry.avatarHue} name={entry.name} />
									</ItemMedia>
									<ItemContent>
										<ItemTitle data-layout-role="account-workspace-title">
											<ItemRouterLink to={orgSwitchPath(entry.slug)}>
												{entry.name}
											</ItemRouterLink>
											{entry.isPersonal ? (
												<Badge size="small" variant="outline">
													Personal
												</Badge>
											) : (
												<span className="type-body-sm text-text-2">
													{ROLE_LABEL.get(entry.role) ?? entry.role}
												</span>
											)}
										</ItemTitle>
									</ItemContent>
									<ItemActions>
										{active ? (
											<Icon icon={Check} label="Current workspace" />
										) : null}
									</ItemActions>
								</Item>
							);
						})}
					</ItemGroup>
				</div>
			</SkeletonSwap>
		</SettingsSection>
	);
}

function AccountDeletion() {
	const [deleting, setDeleting] = useState(false);
	const deleteActionRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<SettingsPanel danger id="delete-account" title="Delete account">
				<SupportingText id="account-delete-description">
					Permanently delete your Tripwire account and its personal data. This
					cannot be undone.
				</SupportingText>
				<div data-layout-role="account-action">
					<DestructiveDialogLauncher
						describedBy="account-delete-description"
						onOpenChange={setDeleting}
						ref={deleteActionRef}
					>
						Delete account
					</DestructiveDialogLauncher>
				</div>
			</SettingsPanel>
			<DeleteAccountDialog
				finalFocus={() => deleteActionRef.current}
				onLeave={() => setDeleting(false)}
				onOpenChange={setDeleting}
				open={deleting}
			/>
		</>
	);
}

function RowsSkeleton() {
	return (
		<div aria-hidden className="shell">
			<ItemGroup>
				{ROW_SLOTS.map((slot) => (
					<Item key={slot}>
						<ItemContent>
							<span data-skeleton-line="" aria-hidden className="w-40">
								<SkeletonText type="label" />
							</span>
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		</div>
	);
}
