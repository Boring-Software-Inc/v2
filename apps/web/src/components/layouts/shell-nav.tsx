import {
	ActivityIcon,
	Analytics01Icon,
	CheckListIcon,
	FlowIcon,
	Queue01Icon,
	Settings01Icon,
	SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useParams } from "@tanstack/react-router";

interface ShellNavProps {
	counts: { queue?: number };
}

/**
 * The nav for whatever scope the URL is in. It lives inside the page shell
 * rather than the topbar because the topbar now belongs to the window (tabs,
 * switcher, account) while this belongs to the page under it.
 *
 * Inside a repo it's the repo's page tree; at org scope it's the cross-repo
 * links. Keeping both in the same slot means org pages carry their nav on every
 * breakpoint — mobile included, where the footer is the tab strip.
 */
export function ShellNav({ counts }: ShellNavProps) {
	// URL-scoped exactly like the topbar (§8): the org and repo in the URL
	// decide the tree.
	const params = useParams({ strict: false });
	const org = params.org;
	const repo = params.repo;

	if (!org) {
		return null;
	}

	if (!repo) {
		return (
			<nav
				aria-label="Organization"
				className="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				<NavLink
					exact={false}
					icon={Analytics01Icon}
					label="Analytics"
					to={`/${org}/analytics`}
				/>
				{/* Settings is the inset dialog (`?settings=`), not a page — it opens
				    over whatever org page you're on. */}
				<NavLink
					activeOptions={{ exact: true, includeSearch: true }}
					icon={Settings01Icon}
					label="Settings"
					search={{ settings: "members" }}
					to="."
				/>
			</nav>
		);
	}

	return (
		<nav
			aria-label="Repository"
			className="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			<NavLink
				icon={Queue01Icon}
				label="Moderation"
				to={`/${org}/${repo}/moderation`}
				value={counts.queue}
			/>
			<NavLink
				icon={ActivityIcon}
				label="Activity"
				to={`/${org}/${repo}/activity`}
			/>
			<NavLink
				icon={CheckListIcon}
				label="Rules"
				to={`/${org}/${repo}/rules`}
			/>
			<NavLink
				icon={FlowIcon}
				label="Workflows"
				to={`/${org}/${repo}/workflows`}
			/>
			<NavLink
				icon={SlidersHorizontalIcon}
				label="Customize"
				to={`/${org}/${repo}/customize`}
			/>
			<NavLink
				exact={false}
				icon={Analytics01Icon}
				label="Analytics"
				to={`/${org}/${repo}/analytics`}
			/>
		</nav>
	);
}

function NavLink({
	to,
	label,
	icon,
	value,
	search,
	exact = true,
	activeOptions,
}: {
	to: string;
	label: string;
	icon: IconSvgElement;
	value?: number;
	search?: Record<string, string>;
	exact?: boolean;
	activeOptions?: { exact: boolean; includeSearch?: boolean };
}) {
	return (
		<Link
			// Search-carrying links (the settings dialog) only read active while
			// their search matches, not whenever the path does.
			activeOptions={activeOptions ?? { exact }}
			activeProps={{ className: "active" }}
			search={search}
			className="flex h-7 shrink-0 items-center gap-2 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-0 hover:text-foreground [&.active]:bg-surface-0 [&.active]:text-foreground"
			to={to}
		>
			<HugeiconsIcon icon={icon} size={14} strokeWidth={2} />
			<span>{label}</span>
			{typeof value === "number" ? (
				<span className="tabular-nums text-muted-foreground">{value}</span>
			) : null}
		</Link>
	);
}
