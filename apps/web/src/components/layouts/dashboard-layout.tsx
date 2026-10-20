import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { DevPersonaSwitcher } from "#/components/dev/persona-switcher";
import {
	FeedbackDialog,
	FeedbackOverlay,
	FeedbackProvider,
} from "#/components/feedback";
import { ShellNav } from "#/components/layouts/shell-nav";
import { OrgSettingsDialog } from "#/components/organizations/org-settings-dialog";
import { useMediaQuery } from "#/hooks/use-media-query";
import { currentUserQueryOptions } from "#/lib/auth.query";
import { cn } from "#/lib/glaze/utils";
import { BetaBanner } from "./beta-banner";
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
	children: ReactNode;
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
	children,
}: DashboardLayoutProps) {
	const { data: user } = useQuery(currentUserQueryOptions());
	const { content, collapsed } = useSidePanel();
	const isDesktop = useMediaQuery("(min-width: 768px)");
	const showPanel = isDesktop && Boolean(content) && !collapsed;
	const params = useParams({ strict: false });
	const inset = Boolean(params.repo);

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
					"isolate flex h-dvh origin-top flex-col transition-[background-color,scale,translate] duration-(--dur-overlay) ease-out inert:translate-y-3 inert:scale-(--scale-overlay)",
					inset ? "bg-page" : "bg-paper",
				)}
				data-shell=""
			>
				<a
					href="#main-content"
					className="-top-12 fixed start-2 z-(--z-overlay) rounded-pill bg-paper px-3 py-1.5 type-label text-text-1 ring-1 ring-ink focus:top-2"
				>
					Skip to content
				</a>
				<DashboardTopbar user={user ?? null} />
				<RouteProgress />

				<div
					className={cn(
						"grid min-h-0 flex-1 transition-[padding] duration-(--dur-overlay) ease-out",
						inset ? "px-2 pb-2" : "px-0 pb-0",
						showPanel
							? "grid-cols-[minmax(0,1fr)_--spacing(82)]"
							: "grid-cols-[minmax(0,1fr)]",
					)}
				>
					<div
						className={cn(
							"relative flex min-h-0 flex-col overflow-hidden bg-paper transition-[border-radius] duration-(--dur-overlay) ease-out",
							inset
								? "rounded-shell border border-line-faint"
								: "rounded-none border-0",
						)}
					>
						<BetaBanner />
						{nav ? <ShellNav counts={counts} /> : null}
						<main
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

				<MobileFooter />
				<DevPersonaSwitcher />
			</div>
			<OrgSettingsDialog />
			<FeedbackOverlay />
			<FeedbackDialog />
		</FeedbackProvider>
	);
}
