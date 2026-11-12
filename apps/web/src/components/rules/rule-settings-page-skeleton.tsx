import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { Skeleton } from "#/design-system/ui/skeleton";

export function RuleSettingsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader title="Rule settings" />
				<PageBody>
					<Skeleton
						aria-label="Loading rule settings"
						className="h-36 w-full"
					/>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
