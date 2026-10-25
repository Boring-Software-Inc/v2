import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FORGE_BY_ID } from "@tripwire/contracts";
import { useTheme } from "next-themes";
import { useState } from "react";
import { DeleteAccountDialog } from "#/components/account/delete-account-dialog";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { ItemRouterLink } from "#/components/common/router-links";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { SkeletonSwap, SkeletonText } from "#/components/glaze/ui/skeleton";
import { Status } from "#/components/glaze/ui/status";
import { Switch } from "#/components/glaze/ui/switch";
import { toast } from "#/components/glaze/ui/toast";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	SettingsHeader,
	SettingsSection,
} from "#/components/settings/settings-frame";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { useHasMounted } from "#/hooks/use-has-mounted";
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
import { authClient } from "#/lib/auth-client";
import type { ForgeConnection } from "#/lib/connections.functions";
import { connectionsQueryOptions } from "#/lib/connections.query";
import { reconnectForge } from "#/lib/forge-connect";
import { myOrgsQueryOptions } from "#/lib/org.query";
import { setAccountTimezone } from "#/lib/timezone.functions";
import { describeUserAgent } from "#/lib/user-agent";

const THEMES = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "Match system" },
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
	const source = forges.size === 1 ? forgeLabel([...forges][0] ?? "") : null;

	return (
		<>
			<SettingsHeader title="Your account" />
			<ProfileSection source={source} user={user} />
			<SignInSection
				connections={connections ?? []}
				loading={connectionsLoading}
				org={org}
				user={user}
			/>
			<SessionsSection />
			<ThemeSection />
			<TimezoneSection />
			<OrgsSection />
			<AccountFooter />
		</>
	);
}

function ProfileSection({
	user,
	source,
}: {
	user: CurrentUser;
	source: string | null;
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
					{source ? (
						<span className="shrink-0 type-body-sm text-text-2">
							From {source}
						</span>
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
							<Link
								className="type-label-sm text-text-1 underline underline-offset-4 hover:text-text-2"
								params={{ org }}
								to="/$org/settings/connections"
							>
								Open Connections
							</Link>
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
				<Button
					aria-label={`Sign in to ${label} again`}
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
					Sign in again
				</Button>
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
						onClick={() => revoke.mutate()}
						pending={revoke.isPending}
						pendingLabel="Signing out"
						size="sm"
						variant="secondary"
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
					<Button
						onClick={() => revokeOthers.mutate()}
						pending={revokeOthers.isPending}
						pendingLabel="Signing out"
						size="sm"
						variant="secondary"
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
					<ItemGroup aria-label="Sessions">
						{(sessions ?? []).map((session) => (
							<SessionRow key={session.id} session={session} />
						))}
					</ItemGroup>
				</div>
			</SkeletonSwap>
		</SettingsSection>
	);
}

function ThemeSection() {
	const { theme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const queryClient = useQueryClient();
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const reduce = session?.user?.reduceAgentMotion ?? false;
	const save = useMutation({
		mutationFn: (next: boolean) => setAgentMotion({ data: { reduce: next } }),
		onError: () =>
			toast.fail("Tripwire could not save the setting. Try again."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	const checked = save.isPending ? (save.variables ?? reduce) : reduce;
	return (
		<SettingsSection id="theme" title="Theme">
			<SegmentedControl
				aria-labelledby="theme-heading"
				onValueChange={setTheme}
				value={hasMounted ? (theme ?? "system") : "system"}
			>
				{THEMES.map((item) => (
					<SegmentedControlItem key={item.value} value={item.value}>
						{item.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>
			<div className="flex max-w-90 items-center justify-between gap-3">
				<span className="type-body" id="agent-motion-label">
					Reduce agent animations
				</span>
				<Switch
					aria-labelledby="agent-motion-label"
					checked={checked}
					disabled={!session?.user}
					onCheckedChange={(next) => save.mutate(next)}
					pending={save.isPending}
				/>
			</div>
		</SettingsSection>
	);
}

function TimezoneSection() {
	const queryClient = useQueryClient();
	const device = useDeviceTimezone();
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const save = useMutation({
		mutationFn: (next: string | null) =>
			setAccountTimezone({ data: { timezone: next } }),
		onSuccess: () => toast.success("Timezone saved"),
		onError: () =>
			toast.fail("Tripwire could not save the timezone. Try again."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	return (
		<SettingsSection id="timezone" title="Timezone">
			<div className="max-w-90">
				<TimezonePicker
					disabled={!session?.user || save.isPending}
					labelledBy="timezone-heading"
					onChange={(next) => save.mutate(next)}
					unsetLabel={`Org timezone, or this device (${device})`}
					value={session?.user?.timezone ?? null}
				/>
			</div>
		</SettingsSection>
	);
}

function OrgsSection() {
	const { data: orgs, isLoading } = useQuery(myOrgsQueryOptions());
	return (
		<SettingsSection id="orgs" title="Orgs">
			<SkeletonSwap
				fallback={<RowsSkeleton />}
				label="Loading orgs"
				loading={isLoading}
			>
				<div className="shell">
					<ItemGroup aria-label="Orgs">
						{(orgs ?? []).map((entry) => (
							<Item key={entry.id}>
								<ItemMedia>
									<OrgAvatar hue={entry.avatarHue} name={entry.name} />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>
										<ItemRouterLink
											params={{ org: entry.slug }}
											to="/$org/home"
										>
											{entry.name}
										</ItemRouterLink>
									</ItemTitle>
								</ItemContent>
								<ItemActions>
									<span className="type-body-sm text-text-2">
										{entry.isPersonal
											? "Personal"
											: (ROLE_LABEL.get(entry.role) ?? entry.role)}
									</span>
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				</div>
			</SkeletonSwap>
		</SettingsSection>
	);
}

function AccountFooter() {
	const [deleting, setDeleting] = useState(false);
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 border-line-faint border-t pt-4">
			<Button
				onClick={() =>
					authClient.signOut({
						fetchOptions: {
							onSuccess: () => window.location.assign("/login"),
						},
					})
				}
				size="sm"
				variant="secondary"
			>
				Sign out
			</Button>
			<Button onClick={() => setDeleting(true)} size="sm" variant="secondary">
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
