import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ItemRouterLink } from "#/components/common/router-links";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import {
	Activity,
	Add,
	Analytics,
	Branch,
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
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { NavChip } from "#/components/layouts/nav-chip";
import { HomeListSkeleton } from "#/components/organizations/org-home-page-skeleton";
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
						<p className="type-body text-text-2">
							Across this org's repos,{" "}
							<span className="text-text-1 tabular-nums">{awaiting}</span>{" "}
							awaiting your decision and{" "}
							<span className="text-text-1 tabular-nums">{blocked}</span>{" "}
							blocked today.
						</p>
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
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Syncing repos</EmptyTitle>
					<EmptyDescription>This takes a moment.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<ItemGroup aria-label="Repos">
			{ranked.map((repo) => (
				<RepoRow key={repo.id} org={org} repo={repo} />
			))}
		</ItemGroup>
	);
}

function InstallCta({ org }: { org: string }) {
	const { data: ctx } = useQuery(orgContextQueryOptions(org));
	const [connecting, setConnecting] = useState(false);
	const isAdmin = ctx?.role === "admin";

	return (
		<Empty>
			<EmptyHeader>
				<EmptyTitle>No repos yet</EmptyTitle>
				<EmptyDescription>
					{isAdmin
						? "Connect the forge your repos live on to start gating contributions."
						: "An admin needs to connect a forge for this org."}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button onClick={() => setConnecting(true)} size="sm">
					<Icon icon={Add} />
					Connect repos
				</Button>
			</EmptyContent>
			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org}
			/>
		</Empty>
	);
}

function RepoRow({ org, repo }: { org: string; repo: SwitcherRepo }) {
	return (
		<Item className="items-start py-2">
			<ItemMedia variant="icon">
				<Icon icon={Branch} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<ItemRouterLink params={{ org, repo: repo.name }} to="/$org/$repo">
						{repo.fullName}
					</ItemRouterLink>
				</ItemTitle>
				<ItemDescription>
					{repo.armed ? attentionLine(repo) : "Tripwire is off"}
					{repo.lastActivityAt
						? ` · ${formatRelativeTime(repo.lastActivityAt)}`
						: null}
				</ItemDescription>
				{repo.armed ? (
					<nav
						aria-label={`Shortcuts for ${repo.fullName}`}
						className="relative z-(--z-raised) mt-2 flex flex-wrap gap-2"
					>
						<NavChip
							icon={Moderation}
							label="Queue"
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
			</ItemContent>
			<ItemMeta className="flex items-center gap-1">
				{repo.armed ? (
					<>
						{repo.pendingModeration > 0 ? (
							<Badge>{repo.pendingModeration} awaiting</Badge>
						) : null}
						{repo.blocked24h > 0 ? (
							<Badge variant="fail">{repo.blocked24h} blocked</Badge>
						) : null}
					</>
				) : (
					<Badge variant="outline">Off</Badge>
				)}
			</ItemMeta>
		</Item>
	);
}

function attentionLine(repo: SwitcherRepo): string {
	if (repo.pendingModeration > 0) {
		return "Needs your decision";
	}
	if (repo.blocked24h > 0) {
		return "Blocking change requests today";
	}
	return "Nothing needs your decision";
}
