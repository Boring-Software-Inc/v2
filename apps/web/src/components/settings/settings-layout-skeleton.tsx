import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	SettingsContentSkeleton,
	SettingsFrame,
	SettingsNavSkeleton,
} from "#/components/settings/settings-frame";

export function SettingsSectionSkeleton() {
	return <SettingsContentSkeleton />;
}

export function SettingsLayoutSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<SettingsFrame nav={<SettingsNavSkeleton />}>
				<SettingsSectionSkeleton />
			</SettingsFrame>
		</DashboardLayout>
	);
}
