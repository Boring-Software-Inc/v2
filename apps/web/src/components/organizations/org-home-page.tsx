import {
	ActivityIcon,
	Analytics01Icon,
	CheckListIcon,
	FlowIcon,
	GitBranchIcon,
	Queue01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { NavChip } from "#/components/layouts/nav-chip";
import { HomeListSkeleton } from "#/components/organizations/org-home-page-skeleton";
import { OrgSubnav } from "#/components/organizations/org-subnav";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { formatRelativeTime } from "#/lib/format-relative-time";
import type { SwitcherRepo } from "#/lib/onboarding.functions";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import { orgContextQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";
import { cn } from "#/lib/utils";

const route = getRouteApi("/$org/home");

/**
 * §8 — /:org/home is the org's cross-repo front door: every repo the org
 * protects, ranked by what needs attention. Clicking a repo navigates INTO it
 * (/:org/:repo) — the URL is the scope, nothing is mutated server-side.
 */
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
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
						<header className="flex flex-col gap-1.5">
							<h1 className="font-semibold text-2xl tracking-tight">Home</h1>
							<p className="text-muted-foreground text-sm">
								across this org's repos —{" "}
								<span className="font-medium text-foreground tabular-nums">
									{awaiting}
								</span>{" "}
								awaiting your decision,{" "}
								<span className="font-medium text-foreground tabular-nums">
									{blocked}
								</span>{" "}
								blocked today.
							</p>
						</header>
						<OrgSubnav org={org} />
					</div>

					{home ? (
						<HomeBody home={home} org={org} ranked={ranked} />
					) : (
						<HomeListSkeleton />
					)}
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
			<div className="rounded-xl bg-card px-5 py-8 text-center text-muted-foreground text-sm">
				syncing repos — this takes a moment.
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			{ranked.map((repo) => (
				<RepoRow key={repo.id} org={org} repo={repo} />
			))}
		</div>
	);
}

/**
 * No installation yet. Admins get the install button (with honest states when
 * the app isn't configured); members are told who can fix it (§10 — the
 * install changes what the org gates, so it's an admin act).
 */
function InstallCta({ org }: { org: string }) {
	const { data: ctx } = useQuery(orgContextQueryOptions(org));
	const isAdmin = ctx?.role === "admin";
	const { data: install, isLoading } = useQuery({
		...orgInstallUrlQueryOptions(org),
		enabled: isAdmin,
	});

	return (
		<div className="flex flex-col items-start gap-3 rounded-xl bg-card px-5 py-6">
			<div className="flex flex-col gap-1">
				<h2 className="font-medium text-sm">no repos yet</h2>
				<p className="text-muted-foreground text-sm">
					{isAdmin
						? "install the github app to start gating contributions for this org."
						: "an admin needs to install the github app."}
				</p>
			</div>
			{isAdmin ? (
				install?.status === "ready" ? (
					<Button asChild size="sm">
						<a href={install.url}>install the app on github</a>
					</Button>
				) : install?.status === "not-configured" ? (
					<p className="text-muted-foreground text-xs">
						the github app isn't configured on this deployment — set
						GITHUB_APP_SLUG.
					</p>
				) : install?.status === "no-session" ? (
					<p className="text-muted-foreground text-xs">
						sign in to install the app.
					</p>
				) : isLoading ? (
					<Skeleton className="h-8 w-48 rounded-md" />
				) : null
			) : null}
		</div>
	);
}

function RepoRow({ org, repo }: { org: string; repo: SwitcherRepo }) {
	// The whole card links into the repo (its default page). Armed repos also get
	// direct feature shortcuts (§8) reachable straight from org home. Nested <a>
	// is invalid, so the card-wide link is a stretched `::after` overlay and the
	// feature toolbar / chips sit above it (relative z-10) to stay clickable.
	return (
		<div className="relative rounded-lg px-3 py-3">
			<div className="flex items-center gap-3">
				<HugeiconsIcon
					className="shrink-0 text-muted-foreground"
					icon={GitBranchIcon}
					size={16}
					strokeWidth={1.8}
				/>
				<Link
					className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-lg"
					params={{ org, repo: repo.name }}
					to="/$org/$repo"
				>
					<div className="truncate font-medium text-sm">{repo.fullName}</div>
					<div className="text-muted-foreground text-xs">
						{repo.armed ? attentionLine(repo) : "available — not armed"}
						{repo.lastActivityAt
							? ` · ${formatRelativeTime(repo.lastActivityAt)}`
							: null}
					</div>
				</Link>
				{repo.armed ? (
					<div className="relative z-10 flex shrink-0 items-center gap-2">
						{repo.pendingModeration > 0 ? (
							<Chip tone="amber">{repo.pendingModeration} awaiting</Chip>
						) : null}
						{repo.blocked24h > 0 ? (
							<Chip tone="red">{repo.blocked24h} blocked</Chip>
						) : null}
					</div>
				) : (
					<span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-muted-foreground text-xs">
						not armed
					</span>
				)}
			</div>
			{repo.armed ? (
				<div className="relative z-10 mt-2.5 flex flex-wrap gap-1.5 pl-7">
					<NavChip
						to={`/${org}/${repo.name}/moderation`}
						label="queue"
						icon={Queue01Icon}
					/>
					<NavChip
						to={`/${org}/${repo.name}/rules`}
						label="rules"
						icon={CheckListIcon}
					/>
					<NavChip
						to={`/${org}/${repo.name}/workflows`}
						label="workflows"
						icon={FlowIcon}
					/>
					<NavChip
						to={`/${org}/${repo.name}/activity`}
						label="activity"
						icon={ActivityIcon}
					/>
					<NavChip
						to={`/${org}/${repo.name}/analytics`}
						label="analytics"
						icon={Analytics01Icon}
					/>
				</div>
			) : null}
		</div>
	);
}

function attentionLine(repo: SwitcherRepo): string {
	if (repo.pendingModeration > 0) {
		return "needs your decision";
	}
	if (repo.blocked24h > 0) {
		return "blocking change requests today";
	}
	return "watching — nothing waiting";
}

function Chip({
	children,
	tone,
}: {
	children: React.ReactNode;
	tone: "amber" | "red";
}) {
	return (
		<span
			className={cn(
				"shrink-0 rounded-full px-2 py-0.5 font-medium text-xs",
				tone === "red"
					? "bg-red-500/10 text-red-600 dark:text-red-400"
					: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
			)}
		>
			{children}
		</span>
	);
}
