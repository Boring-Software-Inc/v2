import { Icon, Pending } from "#/components/glaze/icon";
import { SlowNotice } from "#/components/glaze/ui/slow-notice";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function HomeLoading() {
	return (
		<div className="flex flex-col items-center py-10">
			<Icon
				className="animate-spin text-text-2 motion-reduce:animate-none"
				icon={Pending}
			/>
			<SlowNotice active insetClassName="pt-2 text-center" />
		</div>
	);
}

export function OrgHomePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Home</h1>
					</header>
				</div>
			</div>
		</DashboardLayout>
	);
}
