import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { AccountMenu } from "#/components/layouts/account-menu";
import {
	type NestedNavItem,
	ShellNav,
	ShellSettingsLink,
} from "#/components/layouts/shell-nav";
import { SetupPill } from "#/components/setup/setup-pill";
import { Button } from "#/design-system/ui/button";
import { SidebarSwap } from "#/design-system/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";
import { useActiveScope } from "#/hooks/use-active-scope";
import type { RouteScope } from "#/lib/active-scope";
import type { CurrentUser } from "#/lib/auth.functions";
import { CommandPaletteButton } from "./command-palette-launcher";
import { RepoSwitcher } from "./scope-switchers";

export function DashboardRail({
	user,
	counts,
	nestedNavItem,
	scope: navScope,
	settingsNav,
	collapsed,
	onCollapsedChange,
}: {
	user: CurrentUser | null;
	counts: { queue?: number };
	nestedNavItem?: NestedNavItem;
	scope?: RouteScope;
	settingsNav?: (collapsed: boolean) => ReactNode;
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
}) {
	const scope = useActiveScope();
	const homeOrg = scope.org?.slug ?? navScope?.org;
	const settingsMode = Boolean(settingsNav);
	return (
		<TooltipProvider delay={0}>
			<nav
				aria-label="Primary"
				className={
					collapsed
						? "flex w-[50px] [--sidebar-nested-indent:--spacing(8)] shrink-0 flex-col items-center gap-4 overflow-y-auto px-2 py-2 transition-[width] duration-(--dur-overlay) ease-out"
						: "flex w-56 [--sidebar-nested-indent:--spacing(8)] shrink-0 flex-col gap-4 overflow-y-auto px-1 py-2 transition-[width] duration-(--dur-overlay) ease-out"
				}
			>
				<div
					className={
						collapsed
							? "flex w-full items-center justify-center"
							: "flex items-center justify-between ps-1"
					}
				>
					{collapsed ? (
						<SidebarToggle collapsed onClick={() => onCollapsedChange(false)} />
					) : (
						<>
							<Link
								aria-label={
									homeOrg ? "Tripwire, go to org home" : "Tripwire, go to home"
								}
								className="flex size-[34px] items-center justify-center rounded-tag text-text-1 hover:bg-hover"
								params={homeOrg ? { org: homeOrg } : {}}
								to={homeOrg ? "/$org/home" : "/"}
							>
								<TripwireWordmark height={18} width={28} />
							</Link>
							<SidebarToggle
								collapsed={false}
								onClick={() => onCollapsedChange(true)}
							/>
						</>
					)}
				</div>
				<SidebarSwap
					activeKey={settingsMode ? "settings" : "repo"}
					direction={settingsMode ? "forward" : "back"}
				>
					{settingsMode ? (
						settingsNav?.(collapsed)
					) : (
						<>
							{collapsed ? null : (
								<div className="flex flex-col gap-1">
									<RepoSwitcher appearance="rail" />
									{scope.repo ? <SetupPill appearance="rail" /> : null}
								</div>
							)}
							<CommandPaletteButton collapsed={collapsed} wide={!collapsed} />
							<ShellNav
								collapsed={collapsed}
								counts={counts}
								nestedItem={nestedNavItem}
								scope={navScope}
								variant="rail"
							/>
						</>
					)}
				</SidebarSwap>
				<div
					className={
						collapsed
							? "mt-auto flex flex-col items-center gap-px"
							: "mt-auto flex flex-col gap-px px-1"
					}
				>
					<ShellSettingsLink
						collapsed={collapsed}
						org={scope.org?.slug ?? navScope?.org}
					/>
					<AccountMenu collapsed={collapsed} user={user} />
				</div>
			</nav>
		</TooltipProvider>
	);
}

function SidebarToggle({
	collapsed,
	onClick,
}: {
	collapsed: boolean;
	onClick: () => void;
}) {
	const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
	if (!collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label={label}
							onClick={onClick}
							size="icon"
							variant="ghost"
						/>
					}
				>
					<ShopifySidebarIcon className="size-4!" />
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={16} variant="sidebar">
					{label}
				</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label={label}
						className="group/sidebar-toggle relative size-[34px] overflow-hidden rounded-tag"
						onClick={onClick}
						size="icon"
						variant="ghost"
					/>
				}
			>
				<TripwireWordmark
					className="absolute size-[22px]! transition-[opacity,translate] duration-(--dur-state) ease-out group-hover/sidebar-toggle:translate-y-2 group-hover/sidebar-toggle:opacity-0 group-focus-visible/sidebar-toggle:translate-y-2 group-focus-visible/sidebar-toggle:opacity-0 motion-reduce:transition-none"
					height={22}
					width={22}
				/>
				<ShopifySidebarIcon className="-translate-y-2 absolute size-4! opacity-0 transition-[opacity,translate] duration-(--dur-state) ease-out group-hover/sidebar-toggle:translate-y-0 group-hover/sidebar-toggle:opacity-100 group-focus-visible/sidebar-toggle:translate-y-0 group-focus-visible/sidebar-toggle:opacity-100 motion-reduce:transition-none" />
			</TooltipTrigger>
			<TooltipContent side="right" sideOffset={16} variant="sidebar">
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

function ShopifySidebarIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden
			className={className}
			fill="none"
			height="16"
			viewBox="0 0 16 16"
			width="16"
		>
			<title>Sidebar</title>
			<path
				d="M4.75 4.747v6.503"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
			<rect
				height="12.5"
				rx="3"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
				width="12.5"
				x="1.75"
				y="1.75"
			/>
		</svg>
	);
}
