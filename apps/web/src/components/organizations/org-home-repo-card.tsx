import { useQuery } from "@tanstack/react-query";
import { FORGE_BY_ID } from "@tripwire/contracts";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@tripwire/ui/card";
import {
	Activity,
	Analytics,
	Icon,
	Moderation,
	Rules,
	Workflow,
} from "@tripwire/ui/icon";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { CardRouterLink } from "#/components/common/router-links";
import { ZonedTime } from "#/components/timezones/zoned-time";
import type { SwitcherRepo } from "#/lib/onboarding.functions";
import { orgContextQueryOptions } from "#/lib/org.query";

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

export function OrgHomeRepoCard({
	org,
	repo,
}: {
	org: string;
	repo: SwitcherRepo;
}) {
	const { data: permissions } = useQuery({
		...orgContextQueryOptions(org),
		select: (context) => context.permissions,
	});
	const shortcuts = SHORTCUTS.filter((shortcut) =>
		permissions?.includes(`${shortcut.region}:read`),
	);
	return (
		<Card data-feedback-name="RepoCard">
			<CardRouterLink
				aria-label={`${FORGE_BY_ID[repo.forge].label} repository ${repo.fullName}`}
				data-layout-role="repo-card-header-link"
				params={{ org, repo: repo.name }}
				to="/$org/$repo"
			>
				<CardHeader>
					<CardTitle>
						<span data-layout-role="repo-card-title">
							<ForgeMark forge={repo.forge} />
							<span className="min-w-0">{repo.fullName}</span>
						</span>
					</CardTitle>
					<CardDescription>
						<MetaRow>
							<span>
								{repo.armed
									? attentionLine(repo)
									: repo.forge === "gitcafe"
										? "Connected. GitCafe checks aren't available yet."
										: "Open the repo to turn Tripwire on"}
							</span>
							{repo.lastActivityAt ? (
								<ZonedTime at={repo.lastActivityAt} format="short" />
							) : null}
						</MetaRow>
					</CardDescription>
					{!repo.armed || repo.pendingModeration > 0 || repo.blocked24h > 0 ? (
						<div data-layout-role="repo-card-badges">
							{repo.armed ? (
								<>
									{repo.pendingModeration > 0 ? (
										<Badge>{repo.pendingModeration} to review</Badge>
									) : null}
									{repo.blocked24h > 0 ? (
										<Badge tone="danger">{repo.blocked24h} blocked</Badge>
									) : null}
								</>
							) : (
								<Badge variant="outline">Tripwire off</Badge>
							)}
						</div>
					) : null}
				</CardHeader>
			</CardRouterLink>
			{repo.armed ? (
				<CardFooter>
					<nav
						aria-label={`Shortcuts for ${repo.fullName}`}
						data-layout-role="repo-card-shortcuts"
					>
						{shortcuts.map((shortcut) => (
							<Button
								href={`/${encodeURIComponent(org)}/${encodeURIComponent(repo.name)}/${shortcut.to.split("/").at(-1)}`}
								key={shortcut.to}
								size="small"
								variant="secondary"
							>
								<Icon icon={shortcut.icon} />
								{shortcut.label}
							</Button>
						))}
					</nav>
				</CardFooter>
			) : null}
		</Card>
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
