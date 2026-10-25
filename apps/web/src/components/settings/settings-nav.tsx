import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { orgContextQueryOptions } from "#/lib/org.query";
import {
	ACCOUNT_SECTION_LABELS,
	ACCOUNT_SECTIONS,
	type AccountSection,
	activeAccountSection,
	ORG_SETTINGS_SECTION_LABELS,
	visibleSettingsSections,
} from "#/lib/settings-sections";

const orgRoute = getRouteApi("/$org");

const ITEM_CLASS =
	"flex h-(--control) shrink-0 items-center rounded-tag px-3 type-label text-text-1 transition-colors duration-(--dur-state) ease-out hover:bg-hover aria-[current=page]:bg-pressed";

export function SettingsNav({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const resolved = orgRoute.useRouteContext({
		select: (context) => context.org,
	});
	const permissions = (orgContext ?? resolved).permissions;
	const pathname = useLocation({ select: (location) => location.pathname });
	const hash = useLocation({ select: (location) => location.hash });
	const onAccount = pathname.endsWith("/settings/account");
	const current: AccountSection | null = onAccount
		? activeAccountSection(hash)
		: null;
	const sections = visibleSettingsSections(permissions);

	return (
		<nav
			aria-label="Settings"
			className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-6 md:sticky md:top-6 md:self-start md:overflow-visible md:px-0"
		>
			<NavGroup label={(orgContext ?? resolved).slug}>
				{sections.map((section) => (
					<Link
						activeProps={{ "aria-current": "page" }}
						className={ITEM_CLASS}
						key={section}
						params={{ org }}
						to={`/$org/settings/${section}`}
					>
						{ORG_SETTINGS_SECTION_LABELS[section]}
					</Link>
				))}
			</NavGroup>
			<NavGroup label="Your account">
				{ACCOUNT_SECTIONS.map((section) => (
					<Link
						activeOptions={{ exact: true, includeHash: true }}
						activeProps={{
							"aria-current": current === section ? "page" : undefined,
						}}
						inactiveProps={{
							"aria-current": current === section ? "page" : undefined,
						}}
						className={ITEM_CLASS}
						hash={section}
						key={section}
						params={{ org }}
						to="/$org/settings/account"
					>
						{ACCOUNT_SECTION_LABELS[section]}
					</Link>
				))}
			</NavGroup>
		</nav>
	);
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex shrink-0 gap-1 md:flex-col md:gap-0.5">
			<p className="hidden truncate px-3 pb-1 type-label-sm text-text-2 md:block">
				{label}
			</p>
			{children}
		</div>
	);
}
