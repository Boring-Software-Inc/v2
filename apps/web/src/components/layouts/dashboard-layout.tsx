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
import { currentUserQueryOptions } from "#/lib/auth.query";
import { BetaBanner } from "./beta-banner";
import { DashboardTopbar } from "./dashboard-topbar";
import { MobileFooter } from "./mobile-footer";
import { RouteProgress } from "./route-progress";

interface DashboardLayoutProps {
	counts: { queue?: number };
	children: ReactNode;
}

export function DashboardLayout({ counts, children }: DashboardLayoutProps) {
	const { data: user } = useQuery(currentUserQueryOptions());

	const feedbackConfig = useMemo(
		() => ({ metadata: user?.login ? { user: user.login } : undefined }),
		[user?.login],
	);

	return (
		<FeedbackProvider config={feedbackConfig}>
			<div className="isolate flex h-dvh flex-col bg-page">
				<a
					href="#main-content"
					className="-top-10 fixed start-2 z-(--z-overlay) rounded-pill bg-paper px-3 py-1.5 type-label text-text-1 ring-1 ring-ink focus:top-2"
				>
					Skip to content
				</a>
				<DashboardTopbar user={user ?? null} />
				<RouteProgress />

				<div className="relative flex min-h-0 flex-1 flex-col border-line-faint border-t bg-paper">
					<BetaBanner />
					<ShellNav counts={counts} />
					<main
						id="main-content"
						tabIndex={-1}
						className="min-h-0 flex-1 overflow-y-auto"
					>
						{children}
					</main>
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
