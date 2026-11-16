import { Skeleton } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";

export function RuleSettingsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader title="Rule settings" />
				<PageBody>
					<output
						data-skeleton-box=""
						aria-label="Loading rule settings"
						className="h-36 w-full"
					>
						<Skeleton fill />
					</output>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
