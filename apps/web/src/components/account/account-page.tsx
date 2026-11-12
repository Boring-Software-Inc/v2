import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FORGE_BY_ID, type ForgeConnection } from "@tripwire/contracts";
import { useTheme } from "next-themes";
import { useState } from "react";
import { DeleteAccountDialog } from "#/components/account/delete-account-dialog";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	SettingsHeader,
	SettingsSection,
} from "#/components/settings/settings-frame";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { ZonedTime } from "#/components/timezones/zoned-time";
import {
	ArrowRight,
	Check,
	Dark,
	Icon,
	Light,
	Monitor,
} from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Badge } from "#/design-system/ui/badge";
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
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/design-system/ui/item";
import { SkeletonSwap, SkeletonText } from "#/design-system/ui/skeleton";
import { Status } from "#/design-system/ui/status";
import { Switch } from "#/design-system/ui/switch";
import { toast } from "#/design-system/ui/toast";
import { SupportingText } from "#/design-system/ui/typography";
import { useHasMounted } from "#/hooks/use-has-mounted";
import { useOrgSwitchPath } from "#/hooks/use-org-switch-path";
import { useSignOut } from "#/hooks/use-sign-out";
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
import { myOrgsQueryOptions } from "#/lib/org.query";
import { setAccountTimezone } from "#/lib/timezone.functions";
import { describeUserAgent } from "#/lib/user-agent";

const THEMES = [
	{ value: "light", label: "Light", icon: Light },
	{ value: "dark", label: "Dark", icon: Dark },
	{ value: "system", label: "System", icon: Monitor },
] as const;

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
			<PreferencesSection />
			<OrgsSection activeOrg={org} />
			<AccountFooter />
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
		<SettingsSection id="sign-in" title="Sign-in and GitHub">
			<div className="shell">
				<ItemGroup aria-label="Sign-in">
					{loading ? (
						<Item aria-hidden>
							<ItemContent>
								<SkeletonText className="w-32" type="label" />
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
								nativeButton={false}
								render={
									<Link params={{ org }} to="/$org/settings/connections" />
								}
								size="sm"
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
			<ItemActions className="gap-3">
				<Status size="sm" status={expired ? "warn" : "ok"}>
					{expired ? "Access expired" : "Connected"}
				</Status>
				{expired ? (
					<Button
						aria-label={`Reconnect ${label}`}
						onClick={() => {
							void reconnectForge(connection.forge).then((message) => {
								if (message) {
									toast.fail(message);
								}
							});
						}}
						size="sm"
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
		onSuccess: () => toast.success(`Signed out ${device}`),
		onError: (error) => toast.fail(error.message),
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
						aria-label={`Sign out ${device}`}
						confirmation={{
							actionLabel: "Sign out device",
							description: `This ends the active Tripwire session on ${device}.`,
							pendingLabel: "Signing out",
							title: `Sign out ${device}?`,
						}}
						onAction={() => revoke.mutateAsync()}
						size="sm"
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
		onSuccess: () => toast.success("Signed out everywhere else"),
		onError: (error) => toast.fail(error.message),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: accountQueryKeys.sessions() }),
	});
	return (
		<SettingsSection
			action={
				others > 0 ? (
					<Dialog role="alertdialog">
						<DialogTrigger
							render={
								<Button confirmation={false} size="sm" variant="destructive" />
							}
						>
							Sign out everywhere else
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Sign out everywhere else?</DialogTitle>
								<DialogDescription>
									This keeps this device signed in and ends {others} other{" "}
									{others === 1 ? "session" : "sessions"}.
								</DialogDescription>
							</DialogHeader>
							<DialogBody>
								<SupportingText>
									You will need to sign in again on those devices.
								</SupportingText>
							</DialogBody>
							<DialogFooter>
								<DialogClose>Cancel</DialogClose>
								<DialogAction
									onAction={() => revokeOthers.mutateAsync()}
									pendingLabel="Signing out"
									variant="destructive"
								>
									Sign out
								</DialogAction>
							</DialogFooter>
						</DialogContent>
					</Dialog>
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
						<Empty size="sm" variant="plain">
							<EmptyHeader>
								<EmptyTitle>No active sessions</EmptyTitle>
								<EmptyDescription>
									Sessions appear here after you sign in on a device.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
				</div>
			</SkeletonSwap>
		</SettingsSection>
	);
}

function PreferencesSection() {
	const { theme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const queryClient = useQueryClient();
	const device = useDeviceTimezone();
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const signedIn = Boolean(session?.user);
	const reduce = session?.user?.reduceAgentMotion ?? false;
	const saveMotion = useMutation({
		mutationFn: (next: boolean) => setAgentMotion({ data: { reduce: next } }),
		onError: () =>
			toast.fail("Tripwire could not save the setting. Try again."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	const saveTimezone = useMutation({
		mutationFn: (next: string | null) =>
			setAccountTimezone({ data: { timezone: next } }),
		onSuccess: () => toast.success("Timezone saved"),
		onError: () =>
			toast.fail("Tripwire could not save the timezone. Try again."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	const checked = saveMotion.isPending
		? (saveMotion.variables ?? reduce)
		: reduce;
	return (
		<SettingsSection id="preferences" title="Preferences">
			<div className="flex flex-col gap-3">
				<div>
					<p className="type-label" id="theme-label">
						Theme
					</p>
					<p className="mt-0.5 type-body-sm text-text-2">
						Choose how Tripwire looks on this device.
					</p>
				</div>
				<div
					aria-labelledby="theme-label"
					className="grid grid-cols-1 gap-2 sm:grid-cols-3"
					role="radiogroup"
				>
					{THEMES.map((item) => {
						const selected =
							(hasMounted ? (theme ?? "system") : "system") === item.value;
						return (
							<label className="group relative min-w-0" key={item.value}>
								<input
									checked={selected}
									className="peer sr-only"
									name="theme"
									onChange={() => setTheme(item.value)}
									type="radio"
									value={item.value}
								/>
								<span className="flex min-w-0 cursor-pointer flex-col rounded-overlay border border-line bg-paper p-2 text-start transition-colors duration-(--dur-state) ease-out hover:bg-hover-row peer-checked:border-line-focus peer-checked:bg-pressed peer-focus-visible:focus-ring">
									<ThemePreview value={item.value} />
									<span className="mt-2 flex items-center gap-2 px-1 type-label">
										<Icon icon={item.icon} />
										<span>{item.label}</span>
										{selected ? (
											<span className="ms-auto flex">
												<Icon icon={Check} label="Selected" />
											</span>
										) : null}
									</span>
								</span>
							</label>
						);
					})}
				</div>
				<div className="shell">
					<ItemGroup aria-label="Preferences">
						<Item>
							<ItemContent>
								<ItemTitle id="agent-motion-label">Reduce motion</ItemTitle>
							</ItemContent>
							<ItemActions>
								<Switch
									aria-labelledby="agent-motion-label"
									checked={checked}
									disabled={!signedIn}
									onCheckedChange={(next) => saveMotion.mutate(next)}
									pending={saveMotion.isPending}
								/>
							</ItemActions>
						</Item>
						<Item className="flex-wrap py-2">
							<ItemContent>
								<ItemTitle id="timezone-label">Timezone</ItemTitle>
							</ItemContent>
							<ItemActions className="w-full max-w-80 @max-sm/item:me-0 @max-sm/item:max-w-none">
								<div className="w-full">
									<TimezonePicker
										disabled={!signedIn || saveTimezone.isPending}
										labelledBy="timezone-label"
										onChange={(next) => saveTimezone.mutate(next)}
										unsetLabel={`Organization timezone · ${device}`}
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

function ThemePreview({ value }: { value: (typeof THEMES)[number]["value"] }) {
	if (value === "system") {
		return (
			<span className="flex h-28 gap-1 overflow-hidden rounded-tag border border-[#525252] bg-[#171717] p-1.5">
				<AppShellPreview compact tone="light" />
				<AppShellPreview compact tone="dark" />
			</span>
		);
	}
	return <AppShellPreview tone={value} />;
}

function AppShellPreview({
	tone,
	compact = false,
}: {
	tone: "light" | "dark";
	compact?: boolean;
}) {
	const dark = tone === "dark";
	return (
		<span
			aria-hidden
			className={`flex h-28 min-w-0 overflow-hidden rounded-overlay ${compact ? "flex-1" : "w-full"} ${dark ? "bg-[#090909]" : "bg-[#f5f5f5]"}`}
		>
			<span
				className={`flex w-[24%] shrink-0 flex-col gap-2 p-2 ${dark ? "bg-[#090909]" : "bg-[#f5f5f5]"}`}
			>
				<span
					className={`size-2 rounded-sm ${dark ? "bg-[#e5e5e5]" : "bg-[#262626]"}`}
				/>
				<span
					className={`mt-1 h-1 rounded-pill ${dark ? "bg-[#404040]" : "bg-[#d4d4d4]"}`}
				/>
				<span
					className={`h-1 w-3/4 rounded-pill ${dark ? "bg-[#333333]" : "bg-[#e5e5e5]"}`}
				/>
				<span
					className={`mt-auto h-1 w-2/3 rounded-pill ${dark ? "bg-[#333333]" : "bg-[#e5e5e5]"}`}
				/>
			</span>
			<span
				className={`my-1.5 me-1.5 ms-0.5 flex min-w-0 flex-1 flex-col gap-2 rounded-overlay p-2 shadow-xs ${dark ? "bg-[#1c1c1c]" : "bg-white"}`}
			>
				<span
					className={`h-1.5 w-2/5 rounded-pill ${dark ? "bg-[#737373]" : "bg-[#a3a3a3]"}`}
				/>
				<span
					className={`h-3 w-full rounded-sm ${dark ? "bg-[#292929]" : "bg-[#f0f0f0]"}`}
				/>
				<span
					className={`h-3 w-4/5 rounded-sm ${dark ? "bg-[#242424]" : "bg-[#f5f5f5]"}`}
				/>
				<span
					className={`mt-auto h-1 w-1/2 rounded-pill ${dark ? "bg-[#404040]" : "bg-[#d4d4d4]"}`}
				/>
			</span>
		</span>
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
										<ItemTitle className="flex items-center gap-2">
											<ItemRouterLink to={orgSwitchPath(entry.slug)}>
												{entry.name}
											</ItemRouterLink>
											{entry.isPersonal ? (
												<Badge size="sm" variant="outline">
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

function AccountFooter() {
	const signOut = useSignOut();
	const [deleting, setDeleting] = useState(false);
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 border-line-faint border-t pt-4">
			<Button
				confirmation={{
					actionLabel: "Sign out",
					description:
						"Your session on this device ends. You'll need to sign in again to use Tripwire.",
					pendingLabel: "Signing out",
					title: "Sign out of Tripwire?",
				}}
				onAction={() => signOut.mutateAsync()}
				size="sm"
				variant="destructive"
			>
				Sign out
			</Button>
			<Button
				confirmation={false}
				onClick={() => setDeleting(true)}
				size="sm"
				variant="destructive"
			>
				Delete account
			</Button>
			<DeleteAccountDialog
				onLeave={() => setDeleting(false)}
				onOpenChange={setDeleting}
				open={deleting}
			/>
		</div>
	);
}

function RowsSkeleton() {
	return (
		<div aria-hidden className="shell">
			<ItemGroup>
				{ROW_SLOTS.map((slot) => (
					<Item key={slot}>
						<ItemContent>
							<SkeletonText className="w-40" type="label" />
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		</div>
	);
}
