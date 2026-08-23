import { Analytics01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

/**
 * Org-level navigation — the cross-repo links that used to sit in the topbar.
 * It's deliberately NOT in the topbar: it belongs to the org pages themselves
 * (Home), sitting in the page body so the topbar stays pure identity + repo
 * switcher on every route. Settings opens the inset dialog (`?settings=`),
 * not a page.
 */
export function OrgSubnav({ org }: { org: string }) {
	return (
		<nav aria-label="Organization" className="flex items-center gap-1">
			<OrgLink
				to={`/${org}/analytics`}
				label="Analytics"
				icon={Analytics01Icon}
			/>
			<OrgLink
				to={`/${org}/home`}
				search={{ settings: "members" }}
				activeOptions={{ exact: true, includeSearch: true }}
				label="Settings"
				icon={Settings01Icon}
			/>
		</nav>
	);
}

function OrgLink({
	to,
	label,
	icon,
	search,
	activeOptions = { exact: false },
}: {
	to: string;
	label: string;
	icon: IconSvgElement;
	search?: Record<string, string>;
	activeOptions?: { exact: boolean; includeSearch?: boolean };
}) {
	return (
		<Link
			to={to}
			search={search}
			activeOptions={activeOptions}
			activeProps={{ className: "active" }}
			className="flex h-8 items-center gap-2 rounded-md border bg-surface-1 px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground [&.active]:bg-surface-2 [&.active]:text-foreground"
		>
			<HugeiconsIcon icon={icon} size={14} strokeWidth={2} />
			<span>{label}</span>
		</Link>
	);
}
