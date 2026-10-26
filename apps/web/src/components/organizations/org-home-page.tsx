import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Collection } from "#/components/collection/collection";
import { EntityCard } from "#/components/common/entity-card";
import { MetaRow } from "#/components/common/meta-row";
import { CardRouterLink } from "#/components/common/router-links";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import {
	Activity,
	Add,
	Analytics,
	Icon,
	Moderation,
	Rules,
	Workflow,
} from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import { ApprovedInstallBanner } from "#/components/organizations/approved-install-banner";
import { FirstWeekDigest } from "#/components/organizations/first-week-digest";
import { ORG_REPOS_COLLECTION } from "#/components/organizations/org-home-collection";
import { HomeLoading } from "#/components/organizations/org-home-page-skeleton";
import { AgentSetupCard } from "#/components/setup/agent-setup-card";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { useCollection } from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { useTimezones } from "#/hooks/use-timezones";
import { LIVE_FORGES } from "#/lib/forge-copy";
import { useHomeDigest } from "#/lib/home-digest.query";
import type { SwitcherRepo } from "#/lib/onboarding.functions";
import { orgContextQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";

const route = getRouteApi("/$org/home");

export function OrgHomePage() {
	const { org } = route.useParams();
	const homeQuery = useQuery(orgHomeQueryOptions(org));
	const { display } = useTimezones(org);
	const canReadActivity = useOrgPermission(org, "activity:read");
	const { data: digest } = useHomeDigest(org, canReadActivity);
	const showDigest = Boolean(digest && digest.total > 0);
	const home = homeQuery.data;
	const collection = useCollection(ORG_REPOS_COLLECTION, home?.repos);

	const canSetUp = useOrgPermission(org, "connections:manage");
	const repos = home?.repos ?? [];
	const setupDone = Boolean(
		home?.hasInstallation && repos.some((repo) => repo.armed),
	);
	const awaiting = repos.reduce((sum, r) => sum + r.pendingModeration, 0);
	const blocked = repos.reduce((sum, r) => sum + r.blocked24h, 0);

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div
					className={`mx-auto flex w-full ${showDigest ? "max-w-160" : "max-w-3xl"} flex-col gap-6`}
				>
					{!showDigest ? (
						<header className="flex flex-col gap-1">
							<h1 className="type-title">Home</h1>
							{repos.length > 0 ? (
								<p className="type-body text-text-2">
									Across this org's repos,{" "}
									<span className="text-text-1 tabular-nums">{awaiting}</span>{" "}
									to review and{" "}
									<span className="text-text-1 tabular-nums">{blocked}</span>{" "}
									blocked in the last 24 hours.
								</p>
							) : null}
						</header>
					) : null}

					<ApprovedInstallBanner />

					{home && canSetUp ? (
						<AgentSetupCard org={org} setupDone={setupDone} />
					) : null}

					{showDigest && digest ? (
						<FirstWeekDigest
							org={org}
							digest={digest}
							timeZone={display.zone}
						/>
					) : home && !home.hasInstallation ? (
						<InstallCta org={org} />
					) : (
						<Collection
							collection={collection}
							empty={<NoReposYet org={org} />}
							error={homeQuery.isError}
							onRetry={async () => {
								await homeQuery.refetch({ throwOnError: true });
							}}
							skeleton={<HomeLoading />}
						>
							{(rows) => (
								<ul aria-label="Repos" className="flex flex-col gap-3">
									{rows.map((repo) => (
										<li key={repo.id}>
											<RepoCard org={org} repo={repo} />
										</li>
									))}
								</ul>
							)}
						</Collection>
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}

function NoReposYet({ org }: { org: string }) {
	return (
		<Empty art={<MascotArt mood="repos-syncing" />}>
			<EmptyHeader>
				<EmptyTitle>No repos to show yet</EmptyTitle>
				<EmptyDescription>
					Repos appear here a few seconds after you connect them. If none show
					up, check which repos the connection can see.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button
					nativeButton={false}
					render={<Link params={{ org }} to="/$org/settings/connections" />}
					size="sm"
					variant="secondary"
				>
					Manage connections
				</Button>
			</EmptyContent>
		</Empty>
	);
}

function InstallCta({ org }: { org: string }) {
	const [connecting, setConnecting] = useState(false);
	const isAdmin = useOrgPermission(org, "connections:manage");

	return (
		<Empty art={<MascotArt mood="repos-empty" />}>
			<EmptyHeader>
				<EmptyTitle>No repos yet</EmptyTitle>
				<EmptyDescription>
					{isAdmin
						? `Connect ${LIVE_FORGES} and choose the repos Tripwire checks.`
						: "Ask an admin of this org to connect repos."}
				</EmptyDescription>
			</EmptyHeader>
			{isAdmin ? (
				<EmptyContent>
					<Button
						onClick={() => setConnecting(true)}
						size="sm"
						variant="secondary"
					>
						<Icon icon={Add} />
						Connect repos
					</Button>
				</EmptyContent>
			) : null}
			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org}
			/>
		</Empty>
	);
}

const SHORTCUTS = [
	{
		to: "/$org/$repo/moderation",
		label: "Human review",
		icon: Moderation,
		region: "moderation",
	},
	{ to: "/$org/$repo/rules", label: "Rules", icon: Rules, region: "rules" },
	{
		to: "/$org/$repo/workflows",
		label: "Workflows",
		icon: Workflow,
		region: "workflows",
	},
	{
		to: "/$org/$repo/activity",
		label: "Activity",
		icon: Activity,
		region: "activity",
	},
	{
		to: "/$org/$repo/analytics",
		label: "Analytics",
		icon: Analytics,
		region: "analytics",
	},
] as const;

function RepoCard({ org, repo }: { org: string; repo: SwitcherRepo }) {
	const { data: permissions } = useQuery({
		...orgContextQueryOptions(org),
		select: (context) => context.permissions,
	});
	const shortcuts = SHORTCUTS.filter((shortcut) =>
		permissions?.includes(`${shortcut.region}:read`),
	);
	return (
		<EntityCard
			feedbackName="RepoCard"
			badges={
				repo.armed ? (
					repo.pendingModeration > 0 || repo.blocked24h > 0 ? (
						<>
							{repo.pendingModeration > 0 ? (
								<Badge>{repo.pendingModeration} to review</Badge>
							) : null}
							{repo.blocked24h > 0 ? (
								<Badge variant="fail">{repo.blocked24h} blocked</Badge>
							) : null}
						</>
					) : null
				) : (
					<Badge variant="outline">Tripwire off</Badge>
				)
			}
			description={
				<MetaRow>
					<span>
						{repo.armed
							? attentionLine(repo)
							: "Open the repo to turn Tripwire on"}
					</span>
					{repo.lastActivityAt ? (
						<ZonedTime at={repo.lastActivityAt} format="short" />
					) : null}
				</MetaRow>
			}
			footerActions={
				repo.armed ? (
					<nav
						aria-label={`Shortcuts for ${repo.fullName}`}
						className="flex min-w-0 flex-1 flex-wrap gap-1.5"
					>
						{shortcuts.map((shortcut) => (
							<Button
								key={shortcut.to}
								nativeButton={false}
								render={
									<Link params={{ org, repo: repo.name }} to={shortcut.to} />
								}
								size="sm"
								variant="secondary"
							>
								<Icon icon={shortcut.icon} />
								{shortcut.label}
							</Button>
						))}
					</nav>
				) : undefined
			}
			title={
				<CardRouterLink params={{ org, repo: repo.name }} to="/$org/$repo">
					{repo.fullName}
				</CardRouterLink>
			}
		/>
	);
}

function attentionLine(repo: SwitcherRepo): string {
	if (repo.pendingModeration > 0) {
		return "Has items to review";
	}
	if (repo.blocked24h > 0) {
		return "Blocking change requests today";
	}
	return "Nothing to review";
}
