import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { Forge } from "@tripwire/contracts";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { ArrowRight, Icon } from "#/components/glaze/icon";
import { Alert, AlertTitle } from "#/components/glaze/ui/alert";
import { Badge } from "#/components/glaze/ui/badge";
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
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { InstallSetupPageSkeleton } from "#/components/organizations/install-setup-page-skeleton";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	claimInstallation,
	getInstallPreview,
	type InstallPreview,
	listClaimableInstallations,
} from "#/lib/onboarding.functions";
import { myOrgsQueryOptions, orgQueryKeys } from "#/lib/org.query";

const route = getRouteApi("/onboarding/setup");

/**
 * /onboarding/setup (§10) — the GitHub App Setup callback. NOTHING is claimed
 * automatically: a verified state renders a confirmation naming BOTH sides;
 * a missing/invalid state renders the claim screen with an admin-org picker.
 */
export function InstallSetupPage() {
	const search = route.useSearch();
	const installationId = search.installation_id;

	// GitHub sometimes bounces back WITHOUT installation_id — notably when the
	// App is already installed on the chosen account (nothing new to install)
	// and for pending installation requests. Recover instead of dead-ending.
	if (!installationId) {
		if (search.setup_action === "request") {
			return (
				<SetupShell>
					<SetupCopy
						body="Your installation request needs approval from an admin of that GitHub account. Once they approve, you'll get the callback here."
						title="Waiting on GitHub"
					/>
					<BackHome />
				</SetupShell>
			);
		}
		return <RecoverInstallation state={search.state} />;
	}

	return <SetupFlow installationId={installationId} state={search.state} />;
}

/**
 * The claim screen, reached two ways: GitHub's id-less callback (it confirmed an
 * install but didn't say which), and the GitLab import, which has no callback at
 * all. Both leave unclaimed rows behind, so this offers every unclaimed
 * connection REGARDLESS OF FORGE for an explicit pick — never auto-claimed.
 * Exactly one candidate ⇒ pre-select it into the normal confirm flow, carrying
 * the original signed state so the org confirmation still names both sides.
 */
function RecoverInstallation({ state }: { state: string | undefined }) {
	const { data: claimable } = useQuery({
		queryKey: ["onboarding", "claimable-installations"],
		queryFn: ({ signal }) => listClaimableInstallations({ signal }),
		staleTime: 10_000,
	});
	const [picked, setPicked] = useState<string | null>(null);

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
				<SetupCopy
					body="No unclaimed repos are waiting. If you just connected a forge, give it a moment and refresh, since the sync may still be in flight. Already-connected repos live with their org."
					title="Nothing to connect yet"
				/>
				<BackHome />
			</SetupShell>
		);
	}
	return (
		<SetupShell>
			<SetupCopy
				body="Pick the connection to bind to an org."
				title="Which installation?"
			/>
			<ItemGroup aria-label="Unclaimed connections" className="text-start">
				{claimable.map((c) => {
					const account = c.account ?? "Connection";
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
									{c.repoCount} {c.repoCount === 1 ? "repo" : "repos"}
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
	const { data: preview } = useQuery({
		queryKey: ["onboarding", "install-preview", installationId, state ?? null],
		queryFn: ({ signal }) =>
			getInstallPreview({ data: { installationId, state }, signal }),
		staleTime: 30_000,
	});
	const [pickerOpen, setPickerOpen] = useState(false);

	if (!preview) {
		return <InstallSetupPageSkeleton />;
	}

	if (preview.claimedByOrgSlug) {
		return (
			<SetupShell>
				<SetupCopy
					body="This installation is bound to an org. An installation belongs to exactly one org at a time."
					title={`Already connected to ${preview.claimedByOrgSlug}`}
				/>
				<Button
					nativeButton={false}
					render={
						<Link params={{ org: preview.claimedByOrgSlug }} to="/$org/home" />
					}
				>
					Open the org
				</Button>
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

/** Confirmation — the signed state verified, so both sides can be named. */
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
	return (
		<SetupShell>
			<h1 className="type-title">Connect this installation?</h1>
			<InstallSummary preview={preview} />
			<p className="flex items-center gap-2 type-body text-text-2">
				<Icon icon={ArrowRight} />
				<span>Tripwire</span>
				<OrgAvatar name={stateOrg.name} size="sm" />
				<span className="type-label text-text-1">{stateOrg.name}</span>
			</p>
			<div className="flex flex-wrap items-center justify-center gap-2">
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

/** Claim — no verified state; the caller picks one of their admin orgs. */
function ClaimScreen({ preview }: { preview: InstallPreview }) {
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const claim = useClaimMutation(preview.installationId, preview.forge);
	const adminOrgs = (orgs ?? []).filter((org) => org.role === "admin");

	return (
		<SetupShell>
			<h1 className="type-title">Where should this installation live?</h1>
			<InstallSummary preview={preview} />
			<SkeletonSwap
				fallback={<OrgRowsSkeleton />}
				label="Loading your orgs"
				loading={orgs === undefined}
			>
				{adminOrgs.length === 0 ? (
					<p className="type-body text-text-2">
						You're not an admin of any org. Connecting an installation is an
						admin act.
					</p>
				) : (
					<ItemGroup aria-label="Your admin orgs" className="text-start">
						{adminOrgs.map((org) => (
							<Item key={org.id}>
								<ItemMedia>
									<OrgAvatar name={org.name} size="default" />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>
										<span>{org.name}</span>
										{org.isPersonal ? <Badge size="sm">Personal</Badge> : null}
									</ItemTitle>
								</ItemContent>
								<ItemActions>
									<Button
										aria-label={`Connect to ${org.name}`}
										disabled={claim.isPending && claim.variables !== org.slug}
										onClick={() => claim.mutate(org.slug)}
										pending={claim.isPending && claim.variables === org.slug}
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
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.all }),
		onSuccess: (result, org) => {
			if (result.claimed) {
				toast.success("Connected");
				navigate({ to: `/${org}/home` });
			} else {
				toast.fail("Another org already owns this installation");
			}
		},
	});
}

function ClaimError({ message }: { message: Error }) {
	return (
		<Alert className="text-start" status="fail">
			<AlertTitle>{message.message || "The claim was refused."}</AlertTitle>
		</Alert>
	);
}

function InstallSummary({ preview }: { preview: InstallPreview }) {
	// The preview derives from webhook-synced repos — right after an install
	// the webhook may not have landed yet. Say so instead of "0 repos".
	const syncing = preview.account === null && preview.repoCount === 0;
	return (
		<ItemGroup aria-label="Installation" className="text-start">
			<Item>
				<ItemMedia variant="icon">
					<ForgeMark className="size-(--icon)" forge={preview.forge} />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>
						<span>{preview.account ?? `${preview.forge} connection`}</span>
					</ItemTitle>
					<ItemDescription>
						{syncing
							? "Still syncing from GitHub. The repos land in a moment either way."
							: `${preview.repoCount} ${preview.repoCount === 1 ? "repo" : "repos"}`}
					</ItemDescription>
				</ItemContent>
			</Item>
		</ItemGroup>
	);
}

function OrgRowsSkeleton() {
	return (
		<ItemGroup aria-hidden className="text-start">
			{["a", "b"].map((slot) => (
				<Item key={slot}>
					<ItemMedia>
						<Skeleton className="size-6 rounded-pill" />
					</ItemMedia>
					<ItemContent>
						<SkeletonText className="w-32" type="label" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

function SetupCopy({ title, body }: { title: string; body: string }) {
	return (
		<div className="flex flex-col items-center gap-2">
			<h1 className="type-title">{title}</h1>
			<p className="type-body text-text-2">{body}</p>
		</div>
	);
}

function BackHome() {
	return (
		<Button nativeButton={false} render={<Link to="/" />} variant="secondary">
			Back home
		</Button>
	);
}

function SetupShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-page px-4 py-10">
			<div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
				<TripwireLogo className="text-text-1" size={28} />
				{children}
			</div>
		</div>
	);
}
