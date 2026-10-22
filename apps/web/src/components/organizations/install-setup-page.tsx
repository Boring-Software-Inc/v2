import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { FORGE_CATALOG, type Forge } from "@tripwire/contracts";
import { type ReactNode, useState } from "react";
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
import {
	claimInstallation,
	getInstallPreview,
	type InstallPreview,
	listClaimableInstallations,
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

function SetupFlow({
	installationId,
	state,
}: {
	installationId: string;
	state: string | undefined;
}) {
	const {
		data: preview,
		isError,
		refetch,
	} = useQuery({
		queryKey: ["onboarding", "install-preview", installationId, state ?? null],
		queryFn: ({ signal }) =>
			getInstallPreview({ data: { installationId, state }, signal }),
		staleTime: 30_000,
	});
	const [pickerOpen, setPickerOpen] = useState(false);

	if (isError && !preview) {
		return (
			<LoadError
				onRetry={() => refetch()}
				title="Couldn't load this installation"
			/>
		);
	}
	if (!preview) {
		return <InstallSetupPageSkeleton />;
	}

	if (preview.claimedByOrgSlug) {
		return (
			<SetupShell>
				<SetupHeader
					body="Another Tripwire org already checks this installation. An installation can belong to one org at a time."
					title={`Already connected to ${preview.claimedByOrgSlug}`}
				/>
				<div className="flex justify-center">
					<Button
						nativeButton={false}
						render={
							<Link
								params={{ org: preview.claimedByOrgSlug }}
								to="/$org/home"
							/>
						}
					>
						{`Open ${preview.claimedByOrgSlug}`}
					</Button>
				</div>
			</SetupShell>
		);
	}

	if (preview.stateOrg && !pickerOpen) {
		return (
			<ConfirmScreen
				onChooseDifferent={() => setPickerOpen(true)}
				preview={preview}
				stateOrg={preview.stateOrg}
			/>
		);
	}

	return <ClaimScreen preview={preview} />;
}

function ConfirmScreen({
	preview,
	stateOrg,
	onChooseDifferent,
}: {
	preview: InstallPreview;
	stateOrg: NonNullable<InstallPreview["stateOrg"]>;
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

function ClaimScreen({ preview }: { preview: InstallPreview }) {
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

function SourceRow({ preview }: { preview: InstallPreview }) {
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

function SetupHeader({ title, body }: { title: string; body: string }) {
	return (
		<header className="flex flex-col items-center gap-2 text-center">
			<h1 className="type-title text-balance">{title}</h1>
			<p className="max-w-measure-hint type-body text-pretty text-text-2">
				{body}
			</p>
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
