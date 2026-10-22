import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { FORGE_CATALOG, type Forge } from "@tripwire/contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { Alert, AlertTitle } from "#/components/glaze/ui/alert";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
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
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { MascotArt } from "#/components/mascot/mascot-art";
import { InstallSetupPageSkeleton } from "#/components/organizations/install-setup-page-skeleton";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { authClient } from "#/lib/auth-client";
import {
	type ClaimableInstallStatus,
	claimInstallation,
	getInstallPreview,
	type InstallStatus,
	listClaimableInstallations,
	recoverInstallation,
} from "#/lib/onboarding.functions";
import { onboardingQueryKeys } from "#/lib/onboarding.query";
import { myOrgsQueryOptions, orgQueryKeys } from "#/lib/org.query";

const route = getRouteApi("/onboarding/setup");

export function InstallSetupPage() {
	const search = route.useSearch();
	const installationId = search.installation_id;

	if (!installationId) {
		if (search.setup_action === "request") {
			return (
				<SetupShell>
					<SetupHeader
						body="An admin of that GitHub account has to approve your installation request. When they do, it shows up on your home page, ready to connect."
						title="Waiting for GitHub approval"
					/>
					<BackHome />
				</SetupShell>
			);
		}
		return <RecoverInstallation state={search.state} />;
	}

	return <SetupFlow installationId={installationId} state={search.state} />;
}

function RecoverInstallation({ state }: { state: string | undefined }) {
	const {
		data: claimable,
		isError,
		refetch,
	} = useQuery({
		queryKey: ["onboarding", "claimable-installations"],
		queryFn: ({ signal }) => listClaimableInstallations({ signal }),
		staleTime: 10_000,
	});
	const [picked, setPicked] = useState<string | null>(null);

	if (isError && !claimable) {
		return (
			<LoadError
				onRetry={() => refetch()}
				title="Couldn't load your installations"
			/>
		);
	}
	if (!claimable) {
		return <InstallSetupPageSkeleton />;
	}
	if (
		picked ??
		(claimable.length === 1 ? claimable[0]?.installationId : null)
	) {
		const id = picked ?? (claimable[0]?.installationId as string);
		return <SetupFlow installationId={id} state={state} />;
	}
	if (claimable.length === 0) {
		return (
			<SetupShell>
				<MascotArt mood="install-nothing" />
				<SetupHeader
					body="Tripwire has no new installations to connect. If you installed Tripwire a moment ago, refresh this page in a minute while it loads your repos. Repos you already connected are in their org."
					title="Nothing to connect yet"
				/>
				<BackHome />
			</SetupShell>
		);
	}
	return (
		<SetupShell>
			<SetupHeader
				body="Choose the installation to connect. You pick its Tripwire org next."
				title="Choose an installation"
			/>
			<Card>
				<CardContent flush>
					<ItemGroup aria-label="Unclaimed installations" variant="plain">
						{claimable.map((c) => {
							const account = c.account ?? `${forgeLabel(c.forge)} connection`;
							return (
								<Item key={c.installationId}>
									<ItemMedia variant="icon">
										<ForgeMark className="size-(--icon)" forge={c.forge} />
									</ItemMedia>
									<ItemContent>
										<ItemTitle>
											<span>{account}</span>
										</ItemTitle>
										<ItemDescription>
											<MetaRow>
												<span>{forgeLabel(c.forge)}</span>
												<span>{repoCountLabel(c.repoCount)}</span>
											</MetaRow>
										</ItemDescription>
									</ItemContent>
									<ItemActions className="me-0">
										<Button
											aria-label={`Choose ${account}`}
											onClick={() => setPicked(c.installationId)}
											size="sm"
											variant="secondary"
										>
											Choose
										</Button>
									</ItemActions>
								</Item>
							);
						})}
					</ItemGroup>
				</CardContent>
			</Card>
		</SetupShell>
	);
}

const MISSING_GRACE_MS = 30_000;
const POLL_MS = 2000;

function isWaiting(status: InstallStatus): boolean {
	return (
		status.status === "processing" ||
		status.status === "recovering" ||
		(status.status === "missing" && status.recoverable)
	);
}

function useAutoRecover(
	status: InstallStatus | undefined,
	recover: () => void,
) {
	const fired = useRef(false);
	const waitForWebhook = status?.status === "missing" && status.recoverable;
	const checkNow = status?.status === "not-yours" && status.recoverable;
	useEffect(() => {
		if (fired.current) {
			return;
		}
		if (checkNow) {
			fired.current = true;
			recover();
			return;
		}
		if (!waitForWebhook) {
			return;
		}
		const timer = setTimeout(() => {
			fired.current = true;
			recover();
		}, MISSING_GRACE_MS);
		return () => clearTimeout(timer);
	}, [waitForWebhook, checkNow, recover]);
}

function SetupFlow({
	installationId,
	state,
}: {
	installationId: string;
	state: string | undefined;
}) {
	const queryClient = useQueryClient();
	const {
		data: status,
		isError,
		refetch,
	} = useQuery({
		queryKey: onboardingQueryKeys.installStatus(installationId, state ?? null),
		queryFn: ({ signal }) =>
			getInstallPreview({ data: { installationId, state }, signal }),
		staleTime: 30_000,
		refetchInterval: (query) =>
			query.state.data && isWaiting(query.state.data) ? POLL_MS : false,
	});
	const recovery = useMutation({
		mutationFn: () => recoverInstallation({ data: { installationId } }),
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: onboardingQueryKeys.installStatus(
					installationId,
					state ?? null,
				),
			}),
	});
	useAutoRecover(status, recovery.mutate);
	const [pickerOpen, setPickerOpen] = useState(false);

	if (isError && !status) {
		return (
			<LoadError
				onRetry={() => refetch()}
				title="Couldn't load this installation"
			/>
		);
	}
	if (!status) {
		return <InstallSetupPageSkeleton />;
	}

	switch (status.status) {
		case "claimed-by-your-org":
			return (
				<SetupShell>
					<SetupHeader
						body="Another Tripwire org already checks this installation. An installation can belong to one org at a time."
						title={`Already connected to ${status.orgSlug}`}
					/>
					<div className="flex justify-center">
						<Button
							nativeButton={false}
							render={<Link params={{ org: status.orgSlug }} to="/$org/home" />}
						>
							{`Open ${status.orgSlug}`}
						</Button>
					</div>
				</SetupShell>
			);
		case "processing":
		case "recovering":
			return <ConnectingScreen />;
		case "missing":
			return status.recoverable ? (
				<ConnectingScreen />
			) : (
				<RecoveryScreen
					action="Check again"
					mood="install-nothing"
					onRecover={() => recovery.mutate()}
					pending={recovery.isPending}
					title="Tripwire hasn't heard from GitHub about this install yet"
				/>
			);
		case "unreadable":
			return (
				<RecoveryScreen
					action="Try again"
					mood="route-error"
					onRecover={() => recovery.mutate()}
					pending={recovery.isPending}
					title="Tripwire couldn't read GitHub's install message"
				/>
			);
		case "not-for-tripwire":
			return (
				<SetupShell>
					<MascotArt mood="not-found" />
					<SetupHeader title="This installation isn't for Tripwire" />
					<BackHome />
				</SetupShell>
			);
		case "token-expired":
			return <SignInAgainScreen />;
		case "not-yours":
			return (
				<SetupShell>
					<SetupHeader
						body={`Only the account that installed Tripwire, or requested the install, can connect it. If you installed it a moment ago, this page updates when ${forgeLabel(status.forge)} confirms it.`}
						title="Can't connect this installation"
					/>
					<BackHome />
				</SetupShell>
			);
		case "claimable":
			if (status.stateOrg && !pickerOpen) {
				return (
					<ConfirmScreen
						onChooseDifferent={() => setPickerOpen(true)}
						preview={status}
						stateOrg={status.stateOrg}
					/>
				);
			}
			return <ClaimScreen preview={status} />;
	}
}

function ConnectingScreen() {
	return (
		<SetupShell>
			<MascotArt mood="repos-syncing" />
			<SetupHeader title="Connecting your installation…" />
		</SetupShell>
	);
}

function RecoveryScreen({
	title,
	action,
	mood,
	pending,
	onRecover,
}: {
	title: string;
	action: string;
	mood: "install-nothing" | "route-error";
	pending: boolean;
	onRecover: () => void;
}) {
	return (
		<SetupShell>
			<MascotArt mood={mood} />
			<SetupHeader title={title} />
			<div className="flex flex-wrap justify-center gap-2">
				<Button
					onClick={onRecover}
					pending={pending}
					pendingLabel="Checking"
					type="button"
				>
					{action}
				</Button>
				<Button
					nativeButton={false}
					render={<Link to="/" />}
					variant="secondary"
				>
					Back home
				</Button>
			</div>
		</SetupShell>
	);
}

function SignInAgainScreen() {
	const signIn = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.linkSocial({
				provider: "github",
				callbackURL: `${window.location.pathname}${window.location.search}`,
			});
			if (error) {
				throw new Error(
					error.message ?? "Tripwire couldn't reach GitHub. Try again.",
				);
			}
		},
	});
	return (
		<SetupShell>
			<SetupHeader title="Sign in with GitHub again to connect this installation" />
			<div className="flex justify-center">
				<Button
					onClick={() => signIn.mutate()}
					pending={signIn.isPending}
					pendingLabel="Opening GitHub"
					type="button"
				>
					Sign in with GitHub
				</Button>
			</div>
			{signIn.error ? <ClaimError message={signIn.error} /> : null}
		</SetupShell>
	);
}

function ConfirmScreen({
	preview,
	stateOrg,
	onChooseDifferent,
}: {
	preview: ClaimableInstallStatus;
	stateOrg: NonNullable<ClaimableInstallStatus["stateOrg"]>;
	onChooseDifferent: () => void;
}) {
	const claim = useClaimMutation(preview.installationId, preview.forge);
	const forge = forgeLabel(preview.forge);
	const source = preview.account
		? `the ${preview.account} ${forge} account`
		: `this ${forge} install`;
	return (
		<SetupShell>
			<SetupHeader
				body={`Repos from ${source} go to the ${stateOrg.name} Tripwire org.`}
				title={`Connect ${forge} to ${stateOrg.name}?`}
			/>
			<Card>
				<CardContent flush>
					<ItemGroup aria-label="Connection" variant="plain">
						<SourceRow preview={preview} />
						<Item>
							<ItemMedia>
								<OrgAvatar name={stateOrg.name} size="sm" />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>
									<span>{stateOrg.name}</span>
								</ItemTitle>
								<ItemDescription>Tripwire org</ItemDescription>
							</ItemContent>
						</Item>
					</ItemGroup>
				</CardContent>
			</Card>
			<div className="flex flex-wrap items-center justify-end gap-2">
				<Button onClick={onChooseDifferent} type="button" variant="secondary">
					Choose a different org
				</Button>
				<Button
					onClick={() => claim.mutate(stateOrg.slug)}
					pending={claim.isPending}
					pendingLabel="Connecting"
					type="button"
				>
					{`Connect to ${stateOrg.name}`}
				</Button>
			</div>
			{claim.error ? <ClaimError message={claim.error} /> : null}
		</SetupShell>
	);
}

function ClaimScreen({ preview }: { preview: ClaimableInstallStatus }) {
	const { data: orgs, isError: orgsError } = useQuery(myOrgsQueryOptions());
	const claim = useClaimMutation(preview.installationId, preview.forge);
	const adminOrgs = (orgs ?? []).filter((org) => org.role === "admin");

	return (
		<SetupShell>
			<SetupHeader
				body="Choose the Tripwire org that checks these repos. Only orgs where you are an admin are listed."
				title="Choose an org for this installation"
			/>
			<Card>
				<CardContent flush>
					<ItemGroup aria-label="Installation" variant="plain">
						<SourceRow preview={preview} />
					</ItemGroup>
				</CardContent>
				<CardContent flush>
					<SkeletonSwap
						fallback={<OrgRowsSkeleton />}
						label="Loading your orgs"
						loading={orgs === undefined && !orgsError}
					>
						{orgsError && orgs === undefined ? (
							<p className="px-3 pb-3 type-body-sm text-fail-text" role="alert">
								Couldn't load your orgs. Refresh the page to try again.
							</p>
						) : adminOrgs.length === 0 ? (
							<p className="px-3 pb-3 type-body-sm text-text-2">
								You are not an admin of any org. Ask an org admin to connect
								this installation.
							</p>
						) : (
							<ItemGroup aria-label="Your admin orgs" variant="plain">
								{adminOrgs.map((org) => (
									<Item key={org.id}>
										<ItemMedia>
											<OrgAvatar
												hue={org.avatarHue}
												name={org.name}
												size="sm"
											/>
										</ItemMedia>
										<ItemContent>
											<ItemTitle>
												<span>{org.name}</span>
												{org.isPersonal ? (
													<Badge size="sm">Personal</Badge>
												) : null}
											</ItemTitle>
											{orgSlugDetail(org) ? (
												<ItemDescription>{orgSlugDetail(org)}</ItemDescription>
											) : null}
										</ItemContent>
										<ItemActions className="me-0">
											<Button
												aria-label={`Connect to ${org.name}`}
												disabled={
													claim.isPending && claim.variables !== org.slug
												}
												onClick={() => claim.mutate(org.slug)}
												pending={
													claim.isPending && claim.variables === org.slug
												}
												pendingLabel=""
												size="sm"
											>
												Connect
											</Button>
										</ItemActions>
									</Item>
								))}
							</ItemGroup>
						)}
					</SkeletonSwap>
				</CardContent>
			</Card>
			{claim.error ? <ClaimError message={claim.error} /> : null}
		</SetupShell>
	);
}

function useClaimMutation(installationId: string, forge: Forge) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (org: string) =>
			claimInstallation({ data: { org, installationId, forge } }),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: orgQueryKeys.all }),
				queryClient.invalidateQueries({
					queryKey: onboardingQueryKeys.approvedRequests(),
				}),
			]),
		onSuccess: (result, org) => {
			if (result.claimed) {
				toast.success(`Installation connected to ${org}`);
				navigate({ to: `/${org}/home` });
			} else {
				toast.fail(
					"Another org connected this installation first. Open that org to manage it.",
				);
			}
		},
	});
}

function ClaimError({ message }: { message: Error }) {
	return (
		<Alert status="fail">
			<AlertTitle>
				{message.message ||
					"Couldn't connect this installation. Try again in a moment."}
			</AlertTitle>
		</Alert>
	);
}

function forgeLabel(forge: Forge): string {
	return FORGE_CATALOG.find((entry) => entry.id === forge)?.label ?? forge;
}

function orgSlugDetail(org: { name: string; slug: string }): ReactNode {
	if (org.slug === org.name.toLowerCase().replaceAll(" ", "-")) {
		return null;
	}
	return <span className="mono">{org.slug}</span>;
}

function repoCountLabel(count: number): string {
	return `${count} ${count === 1 ? "repo" : "repos"}`;
}

function SourceRow({ preview }: { preview: ClaimableInstallStatus }) {
	const syncing = preview.account === null && preview.repoCount === 0;
	return (
		<Item>
			<ItemMedia>
				<ForgeMark className="size-5" forge={preview.forge} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span>
						{preview.account ?? `${forgeLabel(preview.forge)} install`}
					</span>
				</ItemTitle>
				<ItemDescription>
					{syncing
						? "Repos sync in the background. You can connect now."
						: `${forgeLabel(preview.forge)} account`}
				</ItemDescription>
			</ItemContent>
		</Item>
	);
}

function OrgRowsSkeleton() {
	return (
		<ItemGroup aria-hidden variant="plain">
			{["a", "b"].map((slot) => (
				<Item key={slot}>
					<ItemMedia>
						<Skeleton className="size-5 rounded-pill" />
					</ItemMedia>
					<ItemContent>
						<SkeletonText className="w-32" type="label" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

function SetupHeader({ title, body }: { title: string; body?: string }) {
	return (
		<header className="flex flex-col items-center gap-2 text-center">
			<h1 className="type-title text-balance">{title}</h1>
			{body ? (
				<p className="max-w-measure-hint type-body text-pretty text-text-2">
					{body}
				</p>
			) : null}
		</header>
	);
}

function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
	return (
		<SetupShell>
			<SetupHeader
				body="Tripwire could not reach the server. Check your connection and try again."
				title={title}
			/>
			<div className="flex flex-wrap justify-center gap-2">
				<Button onClick={onRetry} type="button">
					Try again
				</Button>
				<Button
					nativeButton={false}
					render={<Link to="/" />}
					variant="secondary"
				>
					Back home
				</Button>
			</div>
		</SetupShell>
	);
}

function BackHome() {
	return (
		<div className="flex justify-center">
			<Button nativeButton={false} render={<Link to="/" />} variant="secondary">
				Back home
			</Button>
		</div>
	);
}

function SetupShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-dvh w-full justify-center bg-page px-4 py-10 md:items-center">
			<div className="flex w-full max-w-md flex-col gap-6">
				<div className="flex justify-center">
					<BrandLockup />
				</div>
				{children}
			</div>
		</div>
	);
}
