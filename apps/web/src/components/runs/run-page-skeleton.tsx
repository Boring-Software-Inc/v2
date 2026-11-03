import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";
import { currentUserQueryOptions } from "#/lib/auth.query";

const NODE_SLOTS = [
	{ key: "event", titleSize: "wide", detailSize: "medium" },
	{ key: "checks", titleSize: "medium", detailSize: null },
	{ key: "outcome", titleSize: "narrow", detailSize: "wide" },
] as const;

function RunSkeletonBody() {
	return (
		<Page purpose="task">
			<PageHeader
				actions={
					<>
						<Skeleton data-layout-role="run-skeleton-action-small" />
						<Skeleton data-layout-role="run-skeleton-action-wide" />
					</>
				}
				metadata={
					<SkeletonText
						data-layout-role="run-skeleton-metadata"
						type="body-sm"
					/>
				}
				title="Run"
			/>
			<PageBody>
				<ol aria-hidden data-layout-role="run-skeleton-chain">
					{NODE_SLOTS.map((slot, index) => (
						<li data-layout-role="run-skeleton-node" key={slot.key}>
							<div data-layout-role="run-skeleton-rail">
								<Skeleton data-layout-role="run-skeleton-mark" />
								{index < NODE_SLOTS.length - 1 ? (
									<span data-layout-role="run-skeleton-connector" />
								) : null}
							</div>
							<div data-layout-role="run-skeleton-content">
								<SkeletonText
									data-layout-role="run-skeleton-title"
									data-layout-size={slot.titleSize}
									type="body"
								/>
								{slot.detailSize ? (
									<SkeletonText
										data-layout-role="run-skeleton-detail"
										data-layout-size={slot.detailSize}
										type="body-sm"
									/>
								) : null}
							</div>
						</li>
					))}
				</ol>
			</PageBody>
		</Page>
	);
}

export function RunPageSkeleton() {
	const { data: user } = useQuery(currentUserQueryOptions());
	if (user) {
		return (
			<DashboardLayout counts={{}}>
				<RunSkeletonBody />
			</DashboardLayout>
		);
	}
	return (
		<div data-layout-role="public-run-shell">
			<RunSkeletonBody />
		</div>
	);
}
