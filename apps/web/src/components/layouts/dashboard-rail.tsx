import { Link } from "@tanstack/react-router";
import { IconButton } from "@tripwire/ui/button";
import { UI_MOTION } from "@tripwire/ui/motion";
import { Tooltip } from "@tripwire/ui/tooltip";
import {
	AnimatePresence,
	MotionConfig,
	motion,
	useReducedMotion,
} from "motion/react";
import type { ReactNode } from "react";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { AccountMenu } from "#/components/layouts/account-menu";
import {
	type NestedNavItem,
	ShellNav,
	ShellSettingsLink,
} from "#/components/layouts/shell-nav";
import { SidebarSwap } from "#/components/layouts/sidebar";
import { SetupPill } from "#/components/setup/setup-pill";
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
	const reduceMotion = useReducedMotion();
	const homeOrg = scope.org?.slug ?? navScope?.org;
	const settingsMode = Boolean(settingsNav);
	const railTransition = reduceMotion ? { duration: 0 } : UI_MOTION.position;
	return (
		<MotionConfig transition={railTransition}>
			<nav
				aria-label="Primary"
				data-collapsed={collapsed || undefined}
				data-layout-role="dashboard-rail"
				className={
					collapsed
						? "flex [--sidebar-nested-indent:--spacing(8)] shrink-0 flex-col items-center gap-4 overflow-x-hidden overflow-y-auto px-2 py-2"
						: "flex [--sidebar-nested-indent:--spacing(8)] shrink-0 flex-col gap-4 overflow-x-hidden overflow-y-auto px-1 py-2"
				}
			>
				<div className="flex w-full items-center justify-between">
					<div
						className="relative size-(--sidebar-brand-hit-area) shrink-0"
						data-layout-role="sidebar-brand-slot"
					>
						<AnimatePresence initial={false} mode="sync">
							{collapsed ? (
								<motion.div
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									initial={{ opacity: 0 }}
									key="collapsed-brand"
									transition={railTransition}
								>
									<SidebarToggle
										collapsed
										onClick={() => onCollapsedChange(false)}
									/>
								</motion.div>
							) : (
								<motion.div
									animate={{ opacity: 1 }}
									className="absolute inset-0"
									exit={{ opacity: 0 }}
									initial={{ opacity: 0 }}
									key="expanded-brand"
									transition={railTransition}
								>
									<Link
										aria-label={
											homeOrg
												? "Tripwire, go to org home"
												: "Tripwire, go to home"
										}
										className="flex size-(--sidebar-brand-hit-area) items-center justify-center rounded-tag"
										data-layout-role="sidebar-brand-link"
										params={homeOrg ? { org: homeOrg } : {}}
										to={homeOrg ? "/$org/home" : "/"}
									>
										<TripwireWordmark height={18} width={28} />
									</Link>
								</motion.div>
							)}
						</AnimatePresence>
					</div>
					<AnimatePresence initial={false} mode="popLayout">
						{collapsed ? null : (
							<motion.div
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.96 }}
								initial={{ opacity: 0, scale: 0.96 }}
								key="collapse-sidebar-control"
								transition={reduceMotion ? { duration: 0 } : UI_MOTION.state}
							>
								<SidebarToggle
									collapsed={false}
									onClick={() => onCollapsedChange(true)}
								/>
							</motion.div>
						)}
					</AnimatePresence>
				</div>
				<SidebarSwap
					activeKey={settingsMode ? "settings" : "repo"}
					direction={settingsMode ? "forward" : "back"}
				>
					{settingsMode ? (
						settingsNav?.(collapsed)
					) : (
						<>
							<AnimatePresence initial={false} mode="popLayout">
								{collapsed ? null : (
									<motion.div
										animate={{ opacity: 1, transform: "translateX(0px)" }}
										className="flex flex-col gap-1"
										exit={{
											opacity: 0,
											transform: "translateX(calc(var(--space-1) * -1))",
										}}
										initial={{
											opacity: 0,
											transform: "translateX(calc(var(--space-1) * -1))",
										}}
										transition={
											reduceMotion ? { duration: 0 } : UI_MOTION.state
										}
									>
										<RepoSwitcher appearance="rail" />
										{scope.repo ? <SetupPill appearance="rail" /> : null}
									</motion.div>
								)}
							</AnimatePresence>
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
		</MotionConfig>
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
			<Tooltip
				offset="spacious"
				placement="right"
				trigger={
					<IconButton
						icon={<ShopifySidebarIcon className="size-4!" />}
						label={label}
						onAction={onClick}
						size="small"
						variant="ghost"
					/>
				}
				variant="sidebar"
			>
				{label}
			</Tooltip>
		);
	}
	return (
		<Tooltip
			offset="spacious"
			placement="right"
			trigger={<CollapsedSidebarToggle label={label} onAction={onClick} />}
			variant="sidebar"
		>
			{label}
		</Tooltip>
	);
}

export function CollapsedSidebarToggle({
	label,
	onAction,
}: {
	label: string;
	onAction: () => void;
}) {
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : UI_MOTION.state;
	return (
		<motion.button
			aria-label={label}
			className="relative flex size-(--sidebar-brand-hit-area) items-center justify-center rounded-tag tone-content-primary focus-visible:focus-ring"
			data-layout-role="sidebar-brand-toggle"
			initial="rest"
			onClick={onAction}
			type="button"
			whileFocus="reveal"
			whileHover="reveal"
		>
			<motion.span
				className="absolute inset-0 flex origin-center items-center justify-center opacity-100"
				data-layout-role="sidebar-brand-mark"
				variants={{
					rest: { opacity: 1, scaleX: 1, scaleY: 1 },
					reveal: { opacity: 0, scaleX: 0.5, scaleY: 0.5 },
				}}
				transition={transition}
			>
				<TripwireWordmark height={18} width={28} />
			</motion.span>
			<motion.span
				className="absolute inset-0 flex origin-center items-center justify-center opacity-0"
				data-layout-role="sidebar-brand-expand-icon"
				variants={{
					rest: { opacity: 0, scaleX: 0.5, scaleY: 0.5 },
					reveal: { opacity: 1, scaleX: 1, scaleY: 1 },
				}}
				transition={transition}
			>
				<ShopifySidebarIcon className="size-4!" />
			</motion.span>
		</motion.button>
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
