import { Link } from "@tanstack/react-router";
import { ActionLink } from "@tripwire/ui/button";
import { AdminBlocklistForm } from "#/components/admin/admin-blocklist-form";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
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
						<ActionLink href={siteConfig.pilotUrl}>View public list</ActionLink>
					}
				/>
				<PageBody>
					<AdminBlocklistForm />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
