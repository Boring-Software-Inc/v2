import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import { ApprovedInstallBanner } from "#/components/organizations/approved-install-banner";
import { HomeLoading } from "#/components/organizations/org-home-page-skeleton";
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

					<ApprovedInstallBanner />

					<SkeletonSwap
						delay={400}
						fallback={<HomeLoading />}
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
	{ to: "/$org/$repo/moderation", label: "Human review", icon: Moderation },
	{ to: "/$org/$repo/rules", label: "Rules", icon: Rules },
	{ to: "/$org/$repo/workflows", label: "Workflows", icon: Workflow },
	{ to: "/$org/$repo/activity", label: "Activity", icon: Activity },
	{ to: "/$org/$repo/analytics", label: "Analytics", icon: Analytics },
] as const;

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
				<MetaRow>
					<span>
						{repo.armed
							? attentionLine(repo)
							: "Open the repo to turn Tripwire on"}
					</span>
					{repo.lastActivityAt ? (
						<span>{formatRelativeTime(repo.lastActivityAt)}</span>
					) : null}
				</MetaRow>
			}
			footerActions={
				repo.armed ? (
					<nav
						aria-label={`Shortcuts for ${repo.fullName}`}
						className="flex min-w-0 flex-1 flex-wrap gap-1.5"
					>
						{SHORTCUTS.map((shortcut) => (
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
