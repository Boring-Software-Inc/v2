import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { GithubIcon } from "#/components/icons/github";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { Spinner } from "#/components/ui/spinner";
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
					<h1 className="font-semibold text-[17px] text-foreground">
						waiting on github.
					</h1>
					<p className="text-[13px] text-muted-foreground leading-relaxed">
						your installation request needs approval from an admin of that
						github account. once they approve, you'll get the callback here.
					</p>
					<Button asChild size="sm" variant="outline">
						<Link to="/">back home</Link>
					</Button>
				</SetupShell>
			);
		}
		return <RecoverInstallation state={search.state} />;
	}

	return <SetupFlow installationId={installationId} state={search.state} />;
}

/**
 * The id-less callback: GitHub confirmed an install/update but didn't say
 * WHICH installation. The webhook already synced it — offer every unclaimed
 * installation for an explicit pick (still never auto-claimed). Exactly one
 * candidate ⇒ pre-select it into the normal confirm flow, carrying the
 * original signed state so the org confirmation still names both sides.
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
				<h1 className="font-semibold text-[17px] text-foreground">
					nothing to connect yet.
				</h1>
				<p className="text-[13px] text-muted-foreground leading-relaxed">
					github didn't hand back an installation id, and no unclaimed
					installation has arrived over webhooks. if you just installed, give it
					a moment and refresh — the webhook may still be in flight.
					already-connected installations live with their org.
				</p>
				<Button asChild size="sm" variant="outline">
					<Link to="/">back home</Link>
				</Button>
			</SetupShell>
		);
	}
	return (
		<SetupShell>
			<h1 className="font-semibold text-[17px] text-foreground">
				which installation?
			</h1>
			<p className="text-[13px] text-muted-foreground leading-relaxed">
				github didn't say which installation it just confirmed — pick the one to
				connect.
			</p>
			<div className="flex w-full flex-col gap-1.5">
				{claimable.map((c) => (
					<button
						className="flex items-center gap-2 rounded-md border bg-surface-0 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-1"
						key={c.installationId}
						onClick={() => setPicked(c.installationId)}
						type="button"
					>
						<GithubIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="font-medium text-foreground">
							{c.account ?? "installation"}
						</span>
						<span className="text-muted-foreground">
							{c.repoCount} {c.repoCount === 1 ? "repo" : "repos"}
						</span>
					</button>
				))}
			</div>
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
				<h1 className="font-semibold text-[17px] text-foreground">
					already connected to {preview.claimedByOrgSlug}
				</h1>
				<p className="text-[13px] text-muted-foreground leading-relaxed">
					this installation is bound to an org. an installation belongs to
					exactly one org at a time.
				</p>
				<Button asChild size="sm">
					<Link params={{ org: preview.claimedByOrgSlug }} to="/$org/home">
						open the org
					</Link>
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
	const claim = useClaimMutation(preview.installationId);
	return (
		<SetupShell>
			<h1 className="font-semibold text-[17px] text-foreground">
				connect this installation?
			</h1>
			<GithubSummary preview={preview} />
			<div className="flex items-center gap-2 text-[13px]">
				<span className="text-muted-foreground">→ tripwire</span>
				<OrgAvatar name={stateOrg.name} size={16} />
				<span className="font-medium text-foreground">{stateOrg.name}</span>
			</div>
			<div className="flex flex-col items-center gap-2">
				<Button
					disabled={claim.isPending}
					iconLeft={claim.isPending ? <Spinner size={14} /> : null}
					onClick={() => claim.mutate(stateOrg.slug)}
					size="sm"
					type="button"
				>
					{claim.isPending ? "connecting…" : `connect to ${stateOrg.name}`}
				</Button>
				<button
					className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					onClick={onChooseDifferent}
					type="button"
				>
					choose a different org
				</button>
			</div>
			{claim.error ? <ClaimError message={claim.error} /> : null}
		</SetupShell>
	);
}

/** Claim — no verified state; the caller picks one of their admin orgs. */
function ClaimScreen({ preview }: { preview: InstallPreview }) {
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const claim = useClaimMutation(preview.installationId);
	const adminOrgs = (orgs ?? []).filter((org) => org.role === "admin");

	return (
		<SetupShell>
			<h1 className="font-semibold text-[17px] text-foreground">
				where should this installation live?
			</h1>
			<GithubSummary preview={preview} />
			{orgs === undefined ? (
				<div className="flex w-full flex-col gap-1.5">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : adminOrgs.length === 0 ? (
				<p className="text-[13px] text-muted-foreground leading-relaxed">
					you're not an admin of any org — connecting an installation is an
					admin act.
				</p>
			) : (
				<div className="flex w-full flex-col gap-1">
					{adminOrgs.map((org) => (
						<button
							className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-1 disabled:opacity-60"
							disabled={claim.isPending}
							key={org.id}
							onClick={() => claim.mutate(org.slug)}
							type="button"
						>
							<OrgAvatar hue={org.avatarHue} name={org.name} size={18} />
							<span className="min-w-0 flex-1 truncate font-medium">
								{org.name}
							</span>
							{org.isPersonal ? (
								<span className="text-[11px] text-muted-foreground">
									personal
								</span>
							) : null}
							{claim.isPending && claim.variables === org.slug ? (
								<Spinner size={13} />
							) : null}
						</button>
					))}
				</div>
			)}
			{claim.error ? <ClaimError message={claim.error} /> : null}
		</SetupShell>
	);
}

function useClaimMutation(installationId: string) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (org: string) =>
			claimInstallation({ data: { org, installationId } }),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.all }),
		onSuccess: (result, org) => {
			if (result.claimed) {
				toast.success("connected");
				navigate({ to: `/${org}/home` });
			} else {
				toast.error("another org already owns this installation");
			}
		},
	});
}

function ClaimError({ message }: { message: Error }) {
	return (
		<p className="text-[12px] text-destructive">
			{message.message || "the claim was refused."}
		</p>
	);
}

function GithubSummary({ preview }: { preview: InstallPreview }) {
	// The preview derives from webhook-synced repos — right after an install
	// the webhook may not have landed yet. Say so instead of "0 repos".
	const syncing = preview.account === null && preview.repoCount === 0;
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2 rounded-md border bg-surface-0 px-3 py-2 text-[13px]">
				<GithubIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="font-medium text-foreground">
					{preview.account ?? "github installation"}
				</span>
				<span className="text-muted-foreground">
					{syncing
						? "syncing…"
						: `${preview.repoCount} ${preview.repoCount === 1 ? "repo" : "repos"}`}
				</span>
			</div>
			{syncing ? (
				<p className="text-[11px] text-muted-foreground">
					still syncing from github — the repos land in a moment either way.
				</p>
			) : null}
		</div>
	);
}

function SetupShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
				<TripwireLogo className="text-foreground" size={28} />
				{children}
			</div>
		</div>
	);
}

export function InstallSetupPageSkeleton() {
	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col items-center gap-5">
				<TripwireLogo className="text-foreground" size={28} />
				<Skeleton className="h-5 w-64" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-8 w-40" />
			</div>
		</div>
	);
}
