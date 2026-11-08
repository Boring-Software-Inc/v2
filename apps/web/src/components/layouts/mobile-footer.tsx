import { useLocation } from "@tanstack/react-router";
import { DashboardRail } from "#/components/layouts/dashboard-rail";
import { RepoTabBar } from "#/components/tabs";
import { Button } from "#/design-system/ui/button";
import {
	Sheet,
	SheetBody,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "#/design-system/ui/sheet";
import type { CurrentUser } from "#/lib/auth.functions";

export function MobileFooter({
	counts,
	nav,
	user,
}: {
	counts: { queue?: number };
	nav: boolean;
	user: CurrentUser | null;
}) {
	const pathname = useLocation({ select: (location) => location.pathname });
	return (
		<div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-[max(var(--space-2),env(safe-area-inset-bottom))] md:hidden">
			<Sheet key={pathname}>
				<SheetTrigger render={<Button size="sm" variant="secondary" />}>
					Menu
				</SheetTrigger>
				<SheetContent side="start">
					<SheetHeader>
						<SheetTitle>Navigation</SheetTitle>
					</SheetHeader>
					<SheetBody className="p-0">
						<DashboardRail
							className="w-full flex-1 px-2"
							counts={counts}
							nav={nav}
							user={user}
						/>
					</SheetBody>
				</SheetContent>
			</Sheet>
			<RepoTabBar />
		</div>
	);
}
