import { getRouteApi, Outlet } from "@tanstack/react-router";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { SettingsFrame } from "#/components/settings/settings-frame";
import { SettingsNav } from "#/components/settings/settings-nav";

const orgRoute = getRouteApi("/$org");

export function SettingsLayout() {
	const { org } = orgRoute.useParams();
	return (
		<DashboardLayout counts={{}}>
			<SettingsFrame nav={<SettingsNav org={org} />}>
				<Outlet />
			</SettingsFrame>
		</DashboardLayout>
	);
}
