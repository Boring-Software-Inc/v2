import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { DevScenarioSwitcher } from "#/components/dev/dev-scenario-switcher";
import {
	FeedbackPanel,
	FeedbackPicker,
	FeedbackProvider,
} from "#/components/feedback";
import { type NestedNavItem, ShellNav } from "#/components/layouts/shell-nav";
import { cn } from "#/design-system/lib/utils";
import { useMediaQuery } from "#/hooks/use-media-query";
import type { RouteScope } from "#/lib/active-scope";
import { currentUserQueryOptions } from "#/lib/auth.query";
import { CommandPaletteLauncher } from "./command-palette-launcher";
import { DashboardRail } from "./dashboard-rail";
import {
	SidePanelProvider,
	SidePanelToggle,
	useSidePanel,
} from "./dashboard-side-panel";
import { DashboardTopbar } from "./dashboard-topbar";
import { MobileFooter } from "./mobile-footer";
import { RouteProgress } from "./route-progress";

interface DashboardLayoutProps {
	counts: { queue?: number };
	nav?: boolean;
	nestedNavItem?: NestedNavItem;
	scope?: RouteScope;
	settingsNav?: (collapsed: boolean) => ReactNode;
	children: ReactNode;
}

const SIDEBAR_COLLAPSED_COOKIE = "tripwire-sidebar-collapsed";
const sidebarListeners = new Set<() => void>();
let sidebarCollapsedOverride: boolean | null = null;

function subscribeToSidebarState(listener: () => void): () => void {
	sidebarListeners.add(listener);
	return () => sidebarListeners.delete(listener);
}

function readSidebarState(): boolean {
	if (sidebarCollapsedOverride !== null) {
		return sidebarCollapsedOverride;
	}
	return document.cookie
		.split("; ")
		.some((entry) => entry === `${SIDEBAR_COLLAPSED_COOKIE}=1`);
}

function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
	const collapsed = useSyncExternalStore(
		subscribeToSidebarState,
		readSidebarState,
		() => false,
	);
	const setCollapsed = useCallback((next: boolean) => {
		sidebarCollapsedOverride = next;
		void window.cookieStore.set({
			name: SIDEBAR_COLLAPSED_COOKIE,
			value: next ? "1" : "0",
			path: "/",
			expires: Date.now() + 31_536_000_000,
			sameSite: "lax",
		});
		for (const listener of sidebarListeners) {
			listener();
		}
	}, []);
	return [collapsed, setCollapsed];
}

export function DashboardLayout(props: DashboardLayoutProps) {
	return (
		<SidePanelProvider>
			<DashboardShell {...props} />
		</SidePanelProvider>
	);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function DashboardShell({
	counts,
	nav = true,
	nestedNavItem,
	scope,
	settingsNav,
	children,
}: DashboardLayoutProps) {
	const { data: user } = useQuery(currentUserQueryOptions());
	const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();
	const { content, collapsed } = useSidePanel();
	const isDesktop = useMediaQuery("(min-width: 768px)");
	const showPanel = isDesktop && Boolean(content) && !collapsed;
	const rail = isDesktop;
	const params = useParams({ strict: false });
	const inset = Boolean(params.repo || scope);

	const pageRef = useRef<HTMLElement>(null);
	const restoreTop = useRef(0);
	const hadContent = useRef(false);
	useEffect(() => {
		const open = Boolean(content);
		const opening = open && !hadContent.current;
		const closing = !open && hadContent.current;
		hadContent.current = open;
		const scroller = pageRef.current;
		if (isDesktop || !scroller || (!opening && !closing)) {
			return;
		}
		if (opening) {
			restoreTop.current = scroller.scrollTop;
		}
		scroller.scrollTo({
			top: opening ? scroller.scrollHeight : restoreTop.current,
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	}, [content, isDesktop]);

	const feedbackConfig = useMemo(
		() => ({ metadata: user?.login ? { user: user.login } : undefined }),
		[user?.login],
	);

	return (
		<FeedbackProvider config={feedbackConfig}>
			<div
				className={cn(
					"isolate flex h-[calc(100dvh-var(--impersonation-bar,0rem))] origin-top flex-col transition-[background-color,scale,translate] duration-(--dur-overlay) ease-out inert:translate-y-3 inert:scale-(--scale-overlay)",
					inset || rail ? "bg-page" : "bg-paper",
				)}
				data-shell=""
			>
				<a
					href="#main-content"
					className="-top-12 fixed start-2 z-(--z-overlay) rounded-pill bg-paper px-3 py-1.5 type-label text-text-1 ring-1 ring-ink focus:top-2"
				>
					Skip to content
				</a>
				<div className="md:hidden">
					<DashboardTopbar user={user ?? null} />
					{nav ? (
						<ShellNav
							counts={counts}
							nestedItem={nestedNavItem}
							scope={scope}
						/>
					) : null}
				</div>
				<RouteProgress />

				<div className={cn("flex min-h-0 flex-1", rail && "py-2 pe-2")}>
					{rail ? (
						<DashboardRail
							collapsed={sidebarCollapsed}
							counts={counts}
							nestedNavItem={nestedNavItem}
							onCollapsedChange={setSidebarCollapsed}
							scope={scope}
							settingsNav={settingsNav}
							user={user ?? null}
						/>
					) : null}
					<div
						className={cn(
							"grid min-h-0 flex-1 transition-[padding] duration-(--dur-overlay) ease-out",
							rail ? "p-0" : inset ? "px-2 pt-2 pb-2" : "px-0 pb-0",
							showPanel
								? "grid-cols-[minmax(0,1fr)_--spacing(82)]"
								: "grid-cols-[minmax(0,1fr)]",
						)}
					>
						<div
							className={cn(
								"relative flex min-h-0 flex-col overflow-hidden bg-paper transition-[border-radius] duration-(--dur-overlay) ease-out",
								inset || rail
									? "rounded-shell border border-line-faint"
									: "rounded-none border-0",
							)}
						>
							<main
								data-scroll-restoration-id="main-content"
								id="main-content"
								ref={pageRef}
								tabIndex={-1}
								className="min-h-0 flex-1 overflow-y-auto"
							>
								{children}
							</main>

							{isDesktop || !content ? null : (
								<div className="relative shrink-0 bg-shell">
									<span
										aria-hidden
										className="pointer-events-none absolute start-0 top-0 size-(--radius-shell) -translate-y-full bg-shell"
										data-fillet="start"
									/>
									<span
										aria-hidden
										className="pointer-events-none absolute end-0 top-0 size-(--radius-shell) -translate-y-full bg-shell"
										data-fillet="end"
									/>
									<div className="max-h-[86dvh] min-h-[58dvh] overflow-y-auto">
										{content}
									</div>
								</div>
							)}

							<SidePanelToggle />
						</div>

						{showPanel ? (
							<aside className="hidden min-h-0 overflow-y-auto ps-2 md:block">
								{content}
							</aside>
						) : null}
					</div>
				</div>

				<MobileFooter />
				<CommandPaletteLauncher />
				<DevScenarioSwitcher />
			</div>
			<FeedbackPicker />
			<FeedbackPanel />
		</FeedbackProvider>
	);
}
