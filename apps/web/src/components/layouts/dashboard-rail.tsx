import { type NestedNavItem, ShellNav } from "#/components/layouts/shell-nav";
import { SetupPill } from "#/components/setup/setup-pill";
import { useActiveScope } from "#/hooks/use-active-scope";
import type { RouteScope } from "#/lib/active-scope";
import type { CurrentUser } from "#/lib/auth.functions";
import { CommandPaletteButton } from "./command-palette-launcher";
import { Brand, UserMenu } from "./dashboard-topbar";
import { HeaderFeedbackControl } from "./header-feedback-control";
import { OrgSwitcher, RepoSwitcher } from "./scope-switchers";

export function DashboardRail({
	user,
	counts,
	nestedNavItem,
	scope: navScope,
}: {
	user: CurrentUser | null;
	counts: { queue?: number };
	nestedNavItem?: NestedNavItem;
	scope?: RouteScope;
}) {
	const scope = useActiveScope();
	const org = scope.org?.slug;
	return (
		<nav
			aria-label="Primary"
			className="flex w-56 [--sidebar-nested-indent:--spacing(8)] shrink-0 flex-col gap-4 overflow-y-auto px-1 py-2"
		>
			<div className="flex items-center justify-between ps-1">
				<Brand org={org} />
				<HeaderFeedbackControl />
			</div>
			<div className="flex flex-col gap-1">
				<OrgSwitcher appearance="rail" />
				<RepoSwitcher appearance="rail" />
				{scope.repo ? <SetupPill appearance="rail" /> : null}
			</div>
			<CommandPaletteButton wide />
			<ShellNav
				counts={counts}
				nestedItem={nestedNavItem}
				scope={navScope}
				variant="rail"
			/>
			<div className="mt-auto flex flex-col gap-4">
				<UserMenu showName user={user} />
			</div>
		</nav>
	);
}
