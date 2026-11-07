import { Link } from "@tanstack/react-router";
import { AdminBlocklistForm } from "#/components/admin/admin-blocklist-form";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { Button } from "#/design-system/ui/button";

export function AdminPilotPage() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader
					title="Pilot"
					description="Publish reviewed accounts to the public spam blocklist."
					navigation={<Link to="/admin">Admin</Link>}
					actions={
						<Button
							nativeButton={false}
							render={<Link to="/pilot" />}
							variant="secondary"
						>
							View public list
						</Button>
					}
				/>
				<PageBody>
					<AdminBlocklistForm />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
