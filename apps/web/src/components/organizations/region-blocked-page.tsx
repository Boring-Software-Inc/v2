import type { OrgRegion } from "@tripwire/contracts";
import {
	EmptyState,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { noAccessLine } from "#/lib/region-access";

export function RegionBlockedPage({ region }: { region: OrgRegion }) {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<EmptyState reason="no-access">
						<EmptyStateHeader>
							<EmptyStateTitle>{noAccessLine(region)}</EmptyStateTitle>
						</EmptyStateHeader>
					</EmptyState>
				</div>
			</div>
		</DashboardLayout>
	);
}
