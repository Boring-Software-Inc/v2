import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { EntityCard } from "#/components/common/entity-card";
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
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { NavChip } from "#/components/layouts/nav-chip";
import { MascotArt } from "#/components/mascot/mascot-art";
import { HomeListSkeleton } from "#/components/organizations/org-home-page-skeleton";
import { LIVE_FORGES } from "#/lib/forge-copy";
import { formatRelativeTime } from "#/lib/format-relative-time";
import type { SwitcherRepo } from "#/lib/onboarding.functions";
import { orgContextQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";

const route = getRouteApi("/$org/home");

export function OrgHomePage() {
	const { org } = route.useParams();
	const { data: home, error } = useQuery(orgHomeQueryOptions(org));

	const ranked = useMemo(() => {
		return [...(home?.repos ?? [])].sort(
			(a, b) =>
				b.pendingModeration - a.pendingModeration ||
				b.blocked24h - a.blocked24h ||
				(b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
		);
	}, [home?.repos]);

	if (error) {
		throw error;
	}

	const awaiting = ranked.reduce((sum, r) => sum + r.pendingModeration, 0);
	const blocked = ranked.reduce((sum, r) => sum + r.blocked24h, 0);

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Home</h1>
						{home && ranked.length > 0 ? (
							<p className="type-body text-text-2">
								Across this org's repos,{" "}
								<span className="text-text-1 tabular-nums">{awaiting}</span> to
								review and{" "}
								<span className="text-text-1 tabular-nums">{blocked}</span>{" "}
								blocked in the last 24 hours.
							</p>
						) : null}
					</header>

					<SkeletonSwap
						fallback={<HomeListSkeleton />}
						label="Loading repos"
						loading={!home}
					>
						{home ? <HomeBody home={home} org={org} ranked={ranked} /> : null}
					</SkeletonSwap>
				</div>
			</div>
		</DashboardLayout>
	);
}

function HomeBody({
	home,
	org,
	ranked,
}: {
	home: { hasInstallation: boolean; repos: SwitcherRepo[] };
	org: string;
	ranked: SwitcherRepo[];
}) {
	if (!home.hasInstallation) {
		return <InstallCta org={org} />;
	}
	if (ranked.length === 0) {
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
						render={
							<Link
								params={{ org }}
								search={{ settings: "connections" }}
								to="/$org/home"
							/>
						}
						size="sm"
						variant="secondary"
					>
						Manage connections
					</Button>
				</EmptyContent>
			</Empty>
		);
	}
	return (
		<ul aria-label="Repos" className="flex flex-col gap-3">
			{ranked.map((repo) => (
				<li key={repo.id}>
					<RepoCard org={org} repo={repo} />
				</li>
			))}
		</ul>
	);
}

function InstallCta({ org }: { org: string }) {
	const { data: ctx } = useQuery(orgContextQueryOptions(org));
	const [connecting, setConnecting] = useState(false);
	const isAdmin = ctx?.role === "admin";

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
					<Button onClick={() => setConnecting(true)} size="sm">
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

function RepoCard({ org, repo }: { org: string; repo: SwitcherRepo }) {
	return (
		<EntityCard
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
				<>
					{repo.armed
						? attentionLine(repo)
						: "Open the repo to turn Tripwire on"}
					{repo.lastActivityAt
						? ` · ${formatRelativeTime(repo.lastActivityAt)}`
						: null}
				</>
			}
			title={
				<CardRouterLink params={{ org, repo: repo.name }} to="/$org/$repo">
					{repo.fullName}
				</CardRouterLink>
			}
		>
			{repo.armed ? (
				<nav
					aria-label={`Shortcuts for ${repo.fullName}`}
					className="flex flex-wrap gap-2"
				>
					<NavChip
						icon={Moderation}
						label="Moderation"
						to={`/${org}/${repo.name}/moderation`}
					/>
					<NavChip
						icon={Rules}
						label="Rules"
						to={`/${org}/${repo.name}/rules`}
					/>
					<NavChip
						icon={Workflow}
						label="Workflows"
						to={`/${org}/${repo.name}/workflows`}
					/>
					<NavChip
						icon={Activity}
						label="Activity"
						to={`/${org}/${repo.name}/activity`}
					/>
					<NavChip
						icon={Analytics}
						label="Analytics"
						to={`/${org}/${repo.name}/analytics`}
					/>
				</nav>
			) : null}
		</EntityCard>
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
