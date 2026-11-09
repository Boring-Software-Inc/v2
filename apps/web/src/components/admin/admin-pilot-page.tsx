import { Link } from "@tanstack/react-router";
import { AdminBlocklistForm } from "#/components/admin/admin-blocklist-form";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { buttonVariants } from "#/design-system/ui/button";
import { siteConfig } from "#/lib/site-config";

export function AdminPilotPage() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader
					title="Pilot"
					description="Publish reviewed accounts to the public spam blocklist."
					navigation={<Link to="/admin">Admin</Link>}
					actions={
						<a
							className={buttonVariants({ variant: "secondary" })}
							data-slot="button"
							href={siteConfig.pilotUrl}
						>
							View public list
						</a>
					}
				/>
				<PageBody>
					<AdminBlocklistForm />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
