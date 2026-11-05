import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageHeader } from "#/components/layouts/page";
import { Icon, Pending } from "#/design-system/icon";
import { useSlowWait } from "#/design-system/ui/slow-notice";

export function HomeLoading() {
	useSlowWait(true);
	return (
		<div aria-hidden className="flex justify-center py-10 text-text-2">
			<Icon
				className="animate-spin motion-reduce:animate-none"
				icon={Pending}
			/>
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
