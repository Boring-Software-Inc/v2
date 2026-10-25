import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { SettingsFrame } from "#/components/settings/settings-frame";

const NAV_SLOTS = ["a", "b", "c", "d", "e", "f"] as const;

function SettingsNavSkeleton() {
	return (
		<div aria-hidden className="hidden flex-col gap-1 md:flex">
			{NAV_SLOTS.map((slot) => (
				<div className="flex h-(--control) items-center px-3" key={slot}>
					<SkeletonText className="w-24" type="label" />
				</div>
			))}
		</div>
	);
}

export function SettingsSectionSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-6">
			<div className="flex min-h-(--control-lg) items-center">
				<SkeletonText className="w-40" type="heading" />
			</div>
			<Skeleton className="h-36 w-full rounded-shell" />
		</div>
	);
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
