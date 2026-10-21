import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { FORGE_CATALOG, type Forge } from "@tripwire/contracts";
import { type ReactNode, useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Alert, AlertTitle } from "#/components/glaze/ui/alert";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import {
	DataList,
	DataListItem,
	DataListLabel,
	DataListValue,
} from "#/components/glaze/ui/data-list";
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
					<ListHead>Installation</ListHead>
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
									<ItemActions>
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
				<div>
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
	const source = sourceName(preview);
	return (
		<SetupShell>
			<SetupHeader
				body={`Tripwire will start checking change requests on ${source}'s repos for the ${stateOrg.name} org.`}
				title="Connect this installation?"
			/>
			<Card>
				<CardContent>
					<DataList aria-label="Connection">
						<DataListItem>
							<DataListLabel>{forgeLabel(preview.forge)} account</DataListLabel>
							<DataListValue>
								<SourceSide preview={preview} />
							</DataListValue>
						</DataListItem>
						<DataListItem>
							<DataListLabel>Tripwire org</DataListLabel>
							<DataListValue>
								<Side
									detail={orgSlugDetail(stateOrg)}
									media={<OrgAvatar name={stateOrg.name} size="sm" />}
									name={stateOrg.name}
								/>
							</DataListValue>
						</DataListItem>
					</DataList>
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
				<CardContent>
					<DataList aria-label="Installation">
						<DataListItem>
							<DataListLabel>{forgeLabel(preview.forge)} account</DataListLabel>
							<DataListValue>
								<SourceSide preview={preview} />
							</DataListValue>
						</DataListItem>
					</DataList>
				</CardContent>
				<CardContent flush>
					<ListHead>Tripwire org</ListHead>
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
										<ItemActions>
											<Button
												aria-label={`Connect to ${org.name}`}
												disabled={
													claim.isPending && claim.variables !== org.slug
												}
												onClick={() => claim.mutate(org.slug)}
												pending={
													claim.isPending && claim.variables === org.slug
												}
												pendingLabel="Connecting"
												size="sm"
												variant="secondary"
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

function sourceName(preview: InstallPreview): string {
	return preview.account ?? `this ${forgeLabel(preview.forge)} connection`;
}

function SourceSide({ preview }: { preview: InstallPreview }) {
	const syncing = preview.account === null && preview.repoCount === 0;
	return (
		<Side
			detail={
				syncing ? "Repos still syncing" : repoCountLabel(preview.repoCount)
			}
			media={<ForgeMark className="size-(--icon)" forge={preview.forge} />}
			name={preview.account ?? `${forgeLabel(preview.forge)} connection`}
		/>
	);
}

function Side({
	media,
	name,
	detail,
}: {
	media: ReactNode;
	name: string;
	detail: ReactNode;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="flex size-5 shrink-0 items-center justify-center text-text-1">
				{media}
			</span>
			<span className="truncate type-label text-text-1">{name}</span>
			<span className="shrink-0 type-caption text-text-2">{detail}</span>
		</span>
	);
}

function ListHead({ children }: { children: ReactNode }) {
	return (
		<p className="border-line-faint border-b px-3 py-2 type-label-sm text-text-2">
			{children}
		</p>
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
		<header className="flex flex-col gap-2">
			<h1 className="type-title">{title}</h1>
			<p className="max-w-measure-hint type-body text-text-2">{body}</p>
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
			<div className="flex flex-wrap gap-2">
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
		<div>
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
				<TripwireLogo className="text-text-1" size={28} />
				{children}
			</div>
		</div>
	);
}
