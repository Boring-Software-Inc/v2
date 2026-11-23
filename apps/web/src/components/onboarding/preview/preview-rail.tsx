import type { ForgeId } from "@tripwire/contracts";
import { Avatar } from "@tripwire/ui/avatar";
import {
	Activity,
	Analytics,
	Customize,
	Home,
	type IconGlyph,
	Moderation,
	Rules,
	Settings,
	Workflow,
} from "@tripwire/ui/icon";
import { ForgeMark } from "#/components/common/forge-marks";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { SidebarAccountTrigger } from "#/components/layouts/account-menu";
import { SidebarSearchTrigger } from "#/components/layouts/command-palette-launcher";
import { ShopifySidebarIcon } from "#/components/layouts/dashboard-rail";
import { ScopeSwitcherTrigger } from "#/components/layouts/scope-switchers";
import {
	SidebarNav,
	SidebarNavItemContent,
	SidebarPrimary,
	sidebarNavItemClass,
} from "#/components/layouts/sidebar";

export type PreviewNavKey =
	| "home"
	| "moderation"
	| "activity"
	| "rules"
	| "workflows"
	| "responses"
	| "analytics";

const REPO_NAV: readonly {
	key: PreviewNavKey;
	label: string;
	icon: IconGlyph;
}[] = [
	{ key: "moderation", label: "Human review", icon: Moderation },
	{ key: "activity", label: "Activity", icon: Activity },
	{ key: "rules", label: "Rules", icon: Rules },
	{ key: "workflows", label: "Workflows", icon: Workflow },
	{ key: "responses", label: "Responses", icon: Customize },
	{ key: "analytics", label: "Analytics", icon: Analytics },
];

const ORG_NAV: readonly {
	key: PreviewNavKey;
	label: string;
	icon: IconGlyph;
}[] = [{ key: "home", label: "Home", icon: Home }];

/**
 * The dashboard rail as the preview shows it, built from the same sidebar
 * primitives and triggers as the real one, with nothing wired up: the preview
 * window is inert.
 */
export function PreviewRail({
	repo,
	forge = "github",
	active,
	userName,
	userImage,
	collapsed = false,
}: {
	/** The repo in scope; null shows the org scope with "Pick a repo". */
	repo: string | null;
	forge?: ForgeId;
	active: PreviewNavKey;
	userName: string;
	userImage?: string | null;
	collapsed?: boolean;
}) {
	const nav = repo ? REPO_NAV : ORG_NAV;
	return (
		<SidebarPrimary
			condensed={collapsed}
			data-collapsed={collapsed}
			data-layout-role="onboarding-preview-rail"
		>
			<div data-part="layer">
				<div data-part="header">
					<span data-part="brand">
						<TripwireWordmark
							height={collapsed ? 22 : 18}
							width={collapsed ? 22 : 28}
						/>
					</span>
					{collapsed ? null : (
						<span
							className="flex size-(--control-sm) items-center justify-center rounded-tag"
							data-layout-role="sidebar-toggle"
						>
							<ShopifySidebarIcon className="size-4!" />
						</span>
					)}
				</div>
				<div data-part="body">
					{collapsed ? null : (
						<ScopeSwitcherTrigger
							appearance="rail"
							icon={repo ? <ForgeMark forge={forge} /> : undefined}
							label={repo ?? "Pick a repo"}
							muted={!repo}
							tabIndex={-1}
						/>
					)}
					<SidebarSearchTrigger collapsed={collapsed} tabIndex={-1} />
					<SidebarNav>
						{nav.map((item) => (
							<span
								aria-current={item.key === active ? "page" : undefined}
								className={sidebarNavItemClass({ collapsed })}
								key={item.key}
							>
								<SidebarNavItemContent
									collapsed={collapsed}
									icon={item.icon}
									label={item.label}
								/>
							</span>
						))}
					</SidebarNav>
				</div>
				<div data-part="footer">
					<span className={sidebarNavItemClass({ collapsed })}>
						<SidebarNavItemContent
							collapsed={collapsed}
							icon={Settings}
							label="Settings"
						/>
					</span>
					<SidebarAccountTrigger
						avatar={
							<Avatar decorative name={userName} src={userImage || undefined} />
						}
						collapsed={collapsed}
						name={userName}
						tabIndex={-1}
					/>
				</div>
			</div>
		</SidebarPrimary>
	);
}
