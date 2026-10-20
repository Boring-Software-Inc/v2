import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
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
	children: ReactNode;
}

export function DashboardLayout(props: DashboardLayoutProps) {
	return (
		<SidePanelProvider>
			<DashboardShell {...props} />
		</SidePanelProvider>
	);
}

function DashboardShell({ counts, children }: DashboardLayoutProps) {
	const { data: user } = useQuery(currentUserQueryOptions());
	const { content, collapsed } = useSidePanel();
	const isDesktop = useMediaQuery("(min-width: 768px)");
	const showPanel = isDesktop && Boolean(content) && !collapsed;

	const feedbackConfig = useMemo(
		() => ({ metadata: user?.login ? { user: user.login } : undefined }),
		[user?.login],
	);

	return (
		<FeedbackProvider config={feedbackConfig}>
			<div className="isolate flex h-dvh flex-col bg-page">
				<a
					href="#main-content"
					className="-translate-y-20 fixed start-2 top-2 z-(--z-overlay) rounded-pill bg-paper px-3 py-1.5 type-label text-text-1 ring-1 ring-ink focus:translate-y-0"
				>
					Skip to content
				</a>
				<DashboardTopbar user={user ?? null} />
				<RouteProgress />

				<div
					className={cn(
						"grid min-h-0 flex-1",
						showPanel
							? "grid-cols-[minmax(0,1fr)_--spacing(82)]"
							: "grid-cols-[minmax(0,1fr)]",
					)}
				>
					<div className="relative flex min-h-0 flex-col border-line-faint border-t bg-paper">
						<BetaBanner />
						<ShellNav counts={counts} />
						<main
							id="main-content"
							tabIndex={-1}
							className="min-h-0 flex-1 overflow-y-auto"
						>
							{children}
						</main>

						{isDesktop || !content ? null : (
							<div className="max-h-[86dvh] min-h-[58dvh] shrink-0 overflow-y-auto border-line-faint border-t bg-page">
								{content}
							</div>
						)}

						<SidePanelToggle />
					</div>

					{showPanel ? (
						<aside className="hidden min-h-0 overflow-y-auto border-line-faint border-s border-t bg-page md:block">
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
