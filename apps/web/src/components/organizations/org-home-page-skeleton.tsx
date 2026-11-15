import { Icon, Pending } from "@tripwire/ui/icon";
import { useSlowWait } from "#/components/common/slow-notice";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageHeader } from "#/components/layouts/page";

export function HomeLoading() {
	useSlowWait(true);
	return (
		<div aria-hidden className="flex justify-center py-10 text-text-2">
			<Icon icon={Pending} motion="spin" />
		</div>
	);
}

export function OrgHomePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader title="Home" />
			</Page>
		</DashboardLayout>
	);
}
