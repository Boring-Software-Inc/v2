import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button } from "@tripwire/ui/button";
import { Add, Icon } from "@tripwire/ui/icon";
import { useState } from "react";
import { Collection } from "#/components/collection/collection";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import { MascotArt } from "#/components/mascot/mascot-art";
import { ApprovedInstallBanner } from "#/components/organizations/approved-install-banner";
import { FirstWeekDigest } from "#/components/organizations/first-week-digest";
import { ORG_REPOS_COLLECTION } from "#/components/organizations/org-home-collection";
import { HomeLoading } from "#/components/organizations/org-home-page-skeleton";
import { OrgHomeRepoCard } from "#/components/organizations/org-home-repo-card";
import { AgentSetupCard } from "#/components/setup/agent-setup-card";
import { useCollection } from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { useTimezones } from "#/hooks/use-timezones";
import { useHomeDigest } from "#/lib/home-digest.query";
import { orgHomeQueryOptions } from "#/lib/org.query";

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
			<Page purpose="task">
				{!showDigest ? (
					<PageHeader
						description={
							repos.length > 0
								? `Across this org's repos, ${awaiting} to review and ${blocked} blocked in the last 24 hours.`
								: undefined
						}
						title="Home"
					/>
				) : null}
				<PageBody>
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
					) : null}

					{home && !home.hasInstallation ? (
						<InstallCta org={org} />
					) : (
						<Section id="connected-repos">
							<SectionHeader title="Connected repos" />
							<SectionBody>
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
										<section
											aria-label="Connected repo list"
											data-layout-role="repo-list-scroll"
										>
											<ul
												aria-label="Connected repos"
												data-layout-role="repo-list"
											>
												{rows.map((repo) => (
													<li key={repo.id}>
														<OrgHomeRepoCard org={org} repo={repo} />
													</li>
												))}
											</ul>
										</section>
									)}
								</Collection>
							</SectionBody>
						</Section>
					)}
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}

function NoReposYet({ org }: { org: string }) {
	return (
		<EmptyState art={<MascotArt mood="repos-syncing" />}>
			<EmptyStateHeader>
				<EmptyStateTitle>No repos to show yet</EmptyStateTitle>
				<EmptyStateDescription>
					Repos appear here a few seconds after you connect them. If none show
					up, check which repos the connection can see.
				</EmptyStateDescription>
			</EmptyStateHeader>
			<EmptyStateContent>
				<Button
					href={`/${org}/settings/connections`}
					size="small"
					variant="secondary"
				>
					Manage connections
				</Button>
			</EmptyStateContent>
		</EmptyState>
	);
}

function InstallCta({ org }: { org: string }) {
	const [connecting, setConnecting] = useState(false);
	const isAdmin = useOrgPermission(org, "connections:manage");

	return (
		<EmptyState art={<MascotArt mood="repos-empty" />}>
			<EmptyStateHeader>
				<EmptyStateTitle>No repos yet</EmptyStateTitle>
				<EmptyStateDescription>
					{isAdmin
						? "Connect the repos you want Tripwire to check."
						: "Ask an admin of this org to connect repos."}
				</EmptyStateDescription>
			</EmptyStateHeader>
			{isAdmin ? (
				<EmptyStateContent>
					<Button
						onAction={() => setConnecting(true)}
						size="small"
						variant="secondary"
					>
						<Icon icon={Add} />
						Connect repos
					</Button>
				</EmptyStateContent>
			) : null}
			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org}
			/>
		</EmptyState>
	);
}
