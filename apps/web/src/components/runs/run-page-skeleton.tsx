import { useQuery } from "@tanstack/react-query";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { currentUserQueryOptions } from "#/lib/auth.query";

const NODE_SLOTS = [
	{ key: "event", titleSize: "wide", detailSize: "medium" },
	{ key: "checks", titleSize: "medium", detailSize: null },
	{ key: "outcome", titleSize: "narrow", detailSize: "wide" },
] as const;

export function RunSkeletonBody() {
	return (
		<Page purpose="task">
			<PageHeader
				actions={
					<>
						<span
							data-skeleton-box=""
							aria-hidden
							data-layout-role="run-skeleton-action-small"
						>
							<Skeleton fill />
						</span>
						<span
							data-skeleton-box=""
							aria-hidden
							data-layout-role="run-skeleton-action-wide"
						>
							<Skeleton fill />
						</span>
					</>
				}
				metadata={
					<span
						data-skeleton-line=""
						aria-hidden
						data-layout-role="run-skeleton-metadata"
					>
						<SkeletonText type="body-sm" />
					</span>
				}
				title="Run"
			/>
			<PageBody>
				<ol aria-hidden data-layout-role="run-skeleton-chain">
					{NODE_SLOTS.map((slot, index) => (
						<li data-layout-role="run-skeleton-node" key={slot.key}>
							<div data-layout-role="run-skeleton-rail">
								<span
									data-skeleton-box=""
									aria-hidden
									data-layout-role="run-skeleton-mark"
								>
									<Skeleton fill />
								</span>
								{index < NODE_SLOTS.length - 1 ? (
									<span data-layout-role="run-skeleton-connector" />
								) : null}
							</div>
							<div data-layout-role="run-skeleton-content">
								<span
									data-skeleton-line=""
									aria-hidden
									data-layout-role="run-skeleton-title"
									data-layout-size={slot.titleSize}
								>
									<SkeletonText type="body" />
								</span>
								{slot.detailSize ? (
									<span
										data-skeleton-line=""
										aria-hidden
										data-layout-role="run-skeleton-detail"
										data-layout-size={slot.detailSize}
									>
										<SkeletonText type="body-sm" />
									</span>
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
