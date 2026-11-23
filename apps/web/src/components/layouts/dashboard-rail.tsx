import { Link } from "@tanstack/react-router";
import { Tooltip } from "@tripwire/ui/tooltip";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { AccountMenu } from "#/components/layouts/account-menu";
import {
	type NestedNavItem,
	ShellNav,
	ShellSettingsLink,
} from "#/components/layouts/shell-nav";
import { SidebarFrame, SidebarPrimary } from "#/components/layouts/sidebar";
import { SetupProgress } from "#/components/setup/setup-progress";
import { useActiveScope } from "#/hooks/use-active-scope";
import type { RouteScope } from "#/lib/active-scope";
import type { CurrentUser } from "#/lib/auth.functions";
import { CommandPaletteButton } from "./command-palette-launcher";
import { DashboardRailSkeleton } from "./dashboard-rail-skeleton";
import { RepoSwitcher } from "./scope-switchers";

let expandedSettingsEntryPending = false;

function consumeExpandedSettingsEntry() {
	if (!expandedSettingsEntryPending) return false;
	expandedSettingsEntryPending = false;
	return true;
}

export function DashboardRail({
	user,
	counts,
	nestedNavItem,
	scope: navScope,
	secondarySidebar,
	onSecondarySidebarExitComplete,
	collapsed,
	loading: userPending,
	onCollapsedChange,
}: {
	user: CurrentUser | null;
	counts: { queue?: number };
	nestedNavItem?: NestedNavItem;
	scope?: RouteScope;
	secondarySidebar?: ReactNode;
	onSecondarySidebarExitComplete?: () => void;
	collapsed: boolean;
	loading: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
}) {
	const scope = useActiveScope();
	const loading = userPending || scope.isPending;
	const reduceMotion = useReducedMotion();
	const homeOrg = scope.org?.slug ?? navScope?.org;
	const condensed = collapsed || Boolean(secondarySidebar);
	const [preparedExpandedEntry] = useState(
		() => Boolean(secondarySidebar) && consumeExpandedSettingsEntry(),
	);
	const [visualCondensed, setVisualCondensed] = useState(() =>
		secondarySidebar ? true : collapsed,
	);
	const [railCondensed, setRailCondensed] = useState(() =>
		preparedExpandedEntry ? false : condensed,
	);
	const renderedVisualCondensed = secondarySidebar
		? visualCondensed
		: collapsed;
	const renderedRailCondensed = secondarySidebar ? railCondensed : collapsed;
	useEffect(() => {
		if (secondarySidebar) {
			expandedSettingsEntryPending = false;
		}
		setVisualCondensed(condensed);
		setRailCondensed(condensed);
	}, [condensed, secondarySidebar]);
	const prepareSettingsNavigation = useCallback(() => {
		if (collapsed || secondarySidebar) return;
		setVisualCondensed(true);
		expandedSettingsEntryPending = true;
	}, [collapsed, secondarySidebar]);
	return (
		<SidebarFrame
			onSecondaryExitComplete={onSecondarySidebarExitComplete}
			secondary={secondarySidebar}
		>
			<SidebarPrimary
				animate={{ width: renderedRailCondensed ? 50 : 224 }}
				aria-label="Primary"
				aria-busy={loading || undefined}
				className="relative overflow-hidden [--sidebar-nested-indent:--spacing(8)]"
				condensed={renderedRailCondensed}
				initial={{
					width: preparedExpandedEntry ? 224 : renderedRailCondensed ? 50 : 224,
				}}
				transition={
					reduceMotion
						? { duration: 0 }
						: {
								delay: 0,
								duration: 0.18,
								ease: [0.2, 0.8, 0, 1],
							}
				}
			>
				<AnimatePresence initial={false} mode="popLayout">
					<PrimaryRailLayer
						condensed={renderedVisualCondensed}
						key={renderedVisualCondensed ? "condensed" : "expanded"}
					>
						<div
							className={
								renderedVisualCondensed
									? "flex w-full items-center justify-center"
									: "flex items-center justify-between ps-1"
							}
						>
							{renderedVisualCondensed ? (
								secondarySidebar ? (
									<Link
										aria-label={
											homeOrg
												? "Tripwire, go to org home"
												: "Tripwire, go to home"
										}
										className="flex size-[34px] items-center justify-center rounded-tag"
										params={homeOrg ? { org: homeOrg } : {}}
										to={homeOrg ? "/$org/home" : "/"}
									>
										<TripwireWordmark height={22} width={22} />
									</Link>
								) : (
									<SidebarToggle
										collapsed
										onClick={() => onCollapsedChange(false)}
									/>
								)
							) : (
								<>
									<Link
										aria-label={
											homeOrg
												? "Tripwire, go to org home"
												: "Tripwire, go to home"
										}
										className="flex size-[34px] items-center justify-center rounded-tag"
										data-layout-role="sidebar-brand-link"
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
						{loading ? (
							<DashboardRailSkeleton condensed={renderedVisualCondensed} />
						) : (
							<>
								<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
									{renderedVisualCondensed ? null : (
										<div className="flex flex-col gap-1">
											<RepoSwitcher appearance="rail" />
											{scope.repo ? (
												<SetupProgress
													onDismiss={() => undefined}
													placement="sidebar"
													userId={user?.id}
												/>
											) : null}
										</div>
									)}
									<CommandPaletteButton
										collapsed={renderedVisualCondensed}
										wide={!renderedVisualCondensed}
									/>
									<ShellNav
										collapsed={renderedVisualCondensed}
										counts={counts}
										nestedItem={nestedNavItem}
										scope={navScope}
										variant="rail"
									/>
								</div>
								<div
									className={
										renderedVisualCondensed
											? "mt-auto flex flex-col items-center gap-px"
											: "mt-auto flex flex-col gap-px px-1"
									}
								>
									<ShellSettingsLink
										collapsed={renderedVisualCondensed}
										onBeforeNavigate={prepareSettingsNavigation}
										org={scope.org?.slug ?? navScope?.org}
									/>
									<AccountMenu
										collapsed={renderedVisualCondensed}
										user={user}
									/>
								</div>
							</>
						)}
					</PrimaryRailLayer>
				</AnimatePresence>
			</SidebarPrimary>
		</SidebarFrame>
	);
}

function PrimaryRailLayer({
	children,
	condensed,
}: {
	children: ReactNode;
	condensed: boolean;
}) {
	const isPresent = useIsPresent();
	const reduceMotion = useReducedMotion();
	return (
		<motion.div
			animate={{ opacity: 1, x: 0 }}
			aria-hidden={isPresent ? undefined : true}
			className={
				condensed
					? "absolute inset-y-0 start-0 flex w-[50px] flex-col items-center gap-4 overflow-y-auto px-2 py-2"
					: "absolute inset-0 flex w-56 flex-col gap-4 overflow-y-auto px-1 py-2"
			}
			exit={{ opacity: 0, x: reduceMotion ? 0 : -8 }}
			initial={{ opacity: 0, x: reduceMotion ? 0 : -8 }}
			inert={isPresent ? undefined : true}
			transition={
				reduceMotion
					? { duration: 0 }
					: {
							delay: 0,
							duration: 0.12,
							ease: [0.2, 0.8, 0, 1],
						}
			}
		>
			{children}
		</motion.div>
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
					<button
						aria-label={label}
						className="flex size-(--control-sm) items-center justify-center rounded-tag focus-visible:focus-ring"
						data-layout-role="sidebar-toggle"
						onClick={onClick}
						type="button"
					>
						<ShopifySidebarIcon className="size-4!" />
					</button>
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
	return (
		<button
			aria-label={label}
			className="group/sidebar-toggle relative size-[34px] overflow-hidden rounded-tag focus-visible:focus-ring"
			onClick={onAction}
			type="button"
		>
			<TripwireWordmark
				className="absolute inset-1.5 size-[22px]! transition-[opacity,translate] duration-(--dur-state) ease-out group-hover/sidebar-toggle:translate-y-2 group-hover/sidebar-toggle:opacity-0 group-focus-visible/sidebar-toggle:translate-y-2 group-focus-visible/sidebar-toggle:opacity-0 motion-reduce:transition-none"
				height={22}
				width={22}
			/>
			<ShopifySidebarIcon className="-translate-y-2 absolute inset-[9px] size-4! opacity-0 transition-[opacity,translate] duration-(--dur-state) ease-out group-hover/sidebar-toggle:translate-y-0 group-hover/sidebar-toggle:opacity-100 group-focus-visible/sidebar-toggle:translate-y-0 group-focus-visible/sidebar-toggle:opacity-100 motion-reduce:transition-none" />
		</button>
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
