import {
	ActivityIcon,
	Analytics01Icon,
	CheckListIcon,
	FlowIcon,
	Queue01Icon,
	Settings01Icon,
	SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Link, useMatchRoute, useParams } from "@tanstack/react-router";

interface MobileFooterProps {
	counts: {
		queue?: number;
	};
}

/**
 * The mobile tab bar. Its links are URL-scoped exactly like the topbar (§8): the
 * org (and repo) in the URL decide the tree. Without an org there is nothing to
 * scope, so it renders nothing rather than a set of unprefixed links that bounce
 * through the login redirect. `md:hidden` on the nav itself so it leaves no ghost
 * row on desktop.
 */
export function MobileFooter({ counts }: MobileFooterProps) {
	const params = useParams({ strict: false });
	const matchRoute = useMatchRoute();
	const org = params.org;
	const repo = params.repo;
	if (!org) {
		return null;
	}
	// Org home already surfaces every link this bar would offer (subnav + per-repo
	// chips), so the bar would only duplicate the page.
	if (matchRoute({ to: "/$org/home" })) {
		return null;
	}
	return (
		<nav className="min-w-0 pb-4 md:hidden">
			<div className="flex items-center justify-start gap-0.5 overflow-x-auto scroll-smooth px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{repo ? (
					<>
						<NavLink
							to={`/${org}/${repo}/moderation`}
							label="Moderation"
							icon={Queue01Icon}
							value={counts.queue}
						/>
						<NavLink
							to={`/${org}/${repo}/activity`}
							label="Activity"
							icon={ActivityIcon}
						/>
						<NavLink
							to={`/${org}/${repo}/rules`}
							label="Rules"
							icon={CheckListIcon}
						/>
						<NavLink
							to={`/${org}/${repo}/workflows`}
							label="Workflows"
							icon={FlowIcon}
						/>
						<NavLink
							to={`/${org}/${repo}/customize`}
							label="Customize"
							icon={SlidersHorizontalIcon}
						/>
						<NavLink
							to={`/${org}/${repo}/analytics`}
							label="Analytics"
							icon={Analytics01Icon}
							exact={false}
						/>
					</>
				) : (
					<>
						<NavLink
							to={`/${org}/analytics`}
							label="Analytics"
							icon={Analytics01Icon}
							exact={false}
						/>
						<NavLink
							to="."
							search={{ settings: "members" }}
							label="Settings"
							icon={Settings01Icon}
						/>
					</>
				)}
			</div>
		</nav>
	);
}

function NavLink({
	to,
	label,
	value,
	icon,
	search,
	exact = true,
}: {
	to: string;
	label: string;
	value?: number;
	icon: IconSvgElement;
	search?: Record<string, string>;
	exact?: boolean;
}) {
	return (
		<Link
			to={to}
			search={search}
			// Search-carrying links (the settings dialog) only read active while
			// their search matches, not whenever the path does.
			activeOptions={{ exact, includeSearch: Boolean(search) }}
			className="flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-0 hover:text-foreground [&.active]:bg-surface-0 [&.active]:text-foreground"
			activeProps={{ className: "active" }}
		>
			<HugeiconsIcon icon={icon} size={14} strokeWidth={2} />
			<span>{label}</span>
			{typeof value === "number" ? (
				<span className="tabular-nums text-muted-foreground">{value}</span>
			) : null}
		</Link>
	);
}
