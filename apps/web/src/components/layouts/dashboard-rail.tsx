import { ShellNav } from "#/components/layouts/shell-nav";
import { RepoTabBar, useRepoTabs } from "#/components/tabs";
import { useActiveScope } from "#/hooks/use-active-scope";
import type { CurrentUser } from "#/lib/auth.functions";
import { BetaTag, Brand, UserMenu } from "./dashboard-topbar";
import { RepoSwitcher } from "./repo-switcher";

export function DashboardRail({
	user,
	counts,
}: {
	user: CurrentUser | null;
	counts: { queue?: number };
}) {
	const org = useActiveScope().org?.slug;
	const { hydrated, tabs } = useRepoTabs();
	return (
		<nav
			aria-label="Primary"
			className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto px-1 py-2"
		>
			<div className="flex items-center justify-between ps-1">
				<Brand org={org} />
				<BetaTag />
			</div>
			<RepoSwitcher appearance="rail" />
			<ShellNav counts={counts} variant="rail" />
			{hydrated && tabs.length > 0 ? (
				<section aria-labelledby="open-repos" className="flex flex-col gap-1">
					<h2 className="px-2 type-label-sm text-text-3" id="open-repos">
						Open repos
					</h2>
					<RepoTabBar orientation="column" />
				</section>
			) : null}
			<div className="mt-auto">
				<UserMenu org={org} showName user={user} />
			</div>
		</nav>
	);
}
