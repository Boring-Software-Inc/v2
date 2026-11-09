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
		<nav aria-label="Settings" data-layout-role="settings-nav">
			<NavGroup>
				{sections.map((section) => (
					<Link
						activeProps={{ "aria-current": "page" }}
						data-layout-role="settings-nav-item"
						key={section}
						params={{ org }}
						to={`/$org/settings/${section}`}
					>
						{ORG_SETTINGS_SECTION_LABELS[section]}
					</Link>
				))}
			</NavGroup>
			<NavGroup>
				{ACCOUNT_SECTIONS.map((section) => (
					<Link
						activeOptions={{ exact: true, includeHash: true }}
						activeProps={{
							"aria-current": current === section ? "page" : undefined,
						}}
						inactiveProps={{
							"aria-current": current === section ? "page" : undefined,
						}}
						data-layout-role="settings-nav-item"
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

function NavGroup({ children }: { children: ReactNode }) {
	return <div data-layout-role="settings-nav-group">{children}</div>;
}
