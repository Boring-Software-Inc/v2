import { useQuery } from "@tanstack/react-query";
import {
	getRouteApi,
	Link,
	useLocation,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { settingsReturnDelta } from "#/components/settings/settings-return-history";
import {
	ArrowLeft,
	Billing,
	Bot,
	Connection,
	Customize,
	type GlazeIcon,
	Hide,
	Key,
	Members,
	Organization,
	Settings,
	UserAvatar,
	UserCheck,
} from "#/design-system/icon";
import {
	runSidebarTransition,
	SidebarNav,
	SidebarNavGroup,
	SidebarNavItemContent,
	SidebarNavTooltip,
	sidebarNavItemClass,
} from "#/design-system/ui/sidebar";
import { orgContextQueryOptions } from "#/lib/org.query";
import {
	ACCOUNT_SECTION_LABELS,
	ACCOUNT_SECTIONS,
	type AccountSection,
	activeAccountSection,
	ORG_SETTINGS_SECTION_LABELS,
	type OrgSettingsSection,
	visibleSettingsSections,
} from "#/lib/settings-sections";

const orgRoute = getRouteApi("/$org");

const ORG_SETTINGS_ICONS = {
	members: Members,
	roles: UserCheck,
	general: Settings,
	redaction: Hide,
	connections: Connection,
	agents: Bot,
	billing: Billing,
} satisfies Record<OrgSettingsSection, GlazeIcon>;

const ACCOUNT_SETTINGS_ICONS = {
	profile: UserAvatar,
	"sign-in": Key,
	preferences: Customize,
	orgs: Organization,
} satisfies Record<AccountSection, GlazeIcon>;

export function SettingsNav({
	org,
	variant = "mobile",
	collapsed = false,
}: {
	org: string;
	variant?: "mobile" | "rail";
	collapsed?: boolean;
}) {
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

	if (variant === "mobile") {
		return (
			<nav aria-label="Settings" data-layout-role="settings-nav">
				<MobileNavGroup>
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
				</MobileNavGroup>
				<MobileNavGroup>
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
				</MobileNavGroup>
			</nav>
		);
	}

	return (
		<SidebarNav
			aria-label="Settings"
			data-layout-role={collapsed ? undefined : "settings-sidebar-nav"}
		>
			<SidebarNavGroup data-layout-role="settings-sidebar-back-group">
				<SettingsBack collapsed={collapsed} org={org} />
			</SidebarNavGroup>
			<SidebarNavGroup>
				{sections.map((section) => (
					<OrgSettingsLink
						collapsed={collapsed}
						icon={ORG_SETTINGS_ICONS[section]}
						key={section}
						label={ORG_SETTINGS_SECTION_LABELS[section]}
						org={org}
						section={section}
					/>
				))}
			</SidebarNavGroup>
			<SidebarNavGroup data-layout-role="settings-sidebar-account-group">
				{ACCOUNT_SECTIONS.map((section) => (
					<AccountSettingsLink
						active={current === section}
						collapsed={collapsed}
						icon={ACCOUNT_SETTINGS_ICONS[section]}
						key={section}
						label={ACCOUNT_SECTION_LABELS[section]}
						org={org}
						section={section}
					/>
				))}
			</SidebarNavGroup>
		</SidebarNav>
	);
}

function SettingsBack({ org, collapsed }: { org: string; collapsed: boolean }) {
	const router = useRouter();
	const navigate = useNavigate();
	const control = (
		<button
			className={sidebarNavItemClass({ collapsed })}
			onClick={() => {
				const delta = settingsReturnDelta(
					org,
					router.history.location.state.__TSR_index,
				);
				if (delta !== null) {
					void runSidebarTransition(
						"back",
						() =>
							new Promise<void>((resolve) => {
								const unsubscribe = router.subscribe("onRendered", () => {
									unsubscribe();
									resolve();
								});
								router.history.go(delta);
							}),
					);
					return;
				}
				void navigate({ params: { org }, to: "/$org/home" });
			}}
			type="button"
		>
			<SidebarNavItemContent
				collapsed={collapsed}
				icon={ArrowLeft}
				label="Back"
			/>
		</button>
	);
	return (
		<SidebarNavTooltip collapsed={collapsed} label="Back">
			{control}
		</SidebarNavTooltip>
	);
}

function OrgSettingsLink({
	collapsed,
	icon,
	label,
	org,
	section,
}: {
	collapsed: boolean;
	icon: GlazeIcon;
	label: string;
	org: string;
	section: OrgSettingsSection;
}) {
	const link = (
		<Link
			activeProps={{ "aria-current": "page" }}
			className={sidebarNavItemClass({ collapsed })}
			params={{ org }}
			to={`/$org/settings/${section}`}
		>
			<SidebarNavItemContent collapsed={collapsed} icon={icon} label={label} />
		</Link>
	);
	return (
		<SidebarNavTooltip collapsed={collapsed} label={label}>
			{link}
		</SidebarNavTooltip>
	);
}

function AccountSettingsLink({
	active,
	collapsed,
	icon,
	label,
	org,
	section,
}: {
	active: boolean;
	collapsed: boolean;
	icon: GlazeIcon;
	label: string;
	org: string;
	section: AccountSection;
}) {
	const link = (
		<Link
			activeOptions={{ exact: true, includeHash: true }}
			aria-current={active ? "page" : undefined}
			className={sidebarNavItemClass({ collapsed })}
			hash={section}
			params={{ org }}
			to="/$org/settings/account"
		>
			<SidebarNavItemContent collapsed={collapsed} icon={icon} label={label} />
		</Link>
	);
	return (
		<SidebarNavTooltip collapsed={collapsed} label={label}>
			{link}
		</SidebarNavTooltip>
	);
}

function MobileNavGroup({ children }: { children: ReactNode }) {
	return <div data-layout-role="settings-nav-group">{children}</div>;
}
