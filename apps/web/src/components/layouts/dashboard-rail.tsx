import { ShellNav } from "#/components/layouts/shell-nav";
import { useActiveScope } from "#/hooks/use-active-scope";
import type { CurrentUser } from "#/lib/auth.functions";
import { CommandPaletteButton } from "./command-palette-launcher";
import { BetaTag, Brand, UserMenu } from "./dashboard-topbar";
import { OrgSwitcher, RepoSwitcher } from "./scope-switchers";

export function DashboardRail({
	user,
	counts,
}: {
	user: CurrentUser | null;
	counts: { queue?: number };
}) {
	const org = useActiveScope().org?.slug;
	return (
		<nav
			aria-label="Primary"
			className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto px-1 py-2"
		>
			<div className="flex items-center justify-between ps-1">
				<Brand org={org} />
				<BetaTag />
			</div>
			<div className="flex flex-col gap-1">
				<OrgSwitcher appearance="rail" />
				<RepoSwitcher appearance="rail" />
			</div>
			<CommandPaletteButton wide />
			<ShellNav counts={counts} variant="rail" />
			<div className="mt-auto">
				<UserMenu showName user={user} />
			</div>
		</nav>
	);
}
