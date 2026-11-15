import { Card, CardFooter } from "@tripwire/ui/card";
import { Panel } from "@tripwire/ui/panel";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { RULE_HEADER_CLASS } from "#/components/rules/rule-card-frame";
import { cn } from "#/lib/utils";

const RULE_SLOTS = [
	{ key: "a", name: "w-32" },
	{ key: "b", name: "w-40" },
	{ key: "c", name: "w-24" },
	{ key: "d", name: "w-36" },
	{ key: "e", name: "w-28" },
	{ key: "f", name: "w-32" },
];

export function RuleGridSkeleton() {
	return (
		<div
			aria-hidden
			className="grid items-stretch sm:grid-cols-2"
			data-layout-role="rules-skeleton-grid"
		>
			{RULE_SLOTS.map((slot) => (
				<Card data-layout-role="rule-card-frame" key={slot.key}>
					<Panel data-layout-role="rule-card-panel">
						<div className={RULE_HEADER_CLASS}>
							<span
								data-skeleton-line=""
								aria-hidden
								className={cn(slot.name, "type-label-lg")}
							>
								<SkeletonText type="label" />
							</span>
							<span
								data-skeleton-box=""
								aria-hidden
								className="h-4 w-7 shrink-0 rounded-pill"
								data-layout-role="rules-skeleton-toggle"
							>
								<Skeleton fill />
							</span>
						</div>
						<SkeletonText lines={2} type="body-sm" />
					</Panel>
					<CardFooter data-layout-role="rule-card-footer">
						<span data-skeleton-line="" aria-hidden className="w-14">
							<SkeletonText type="label-sm" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-28">
							<SkeletonText type="caption" />
						</span>
					</CardFooter>
				</Card>
			))}
		</div>
	);
}

export function RulesPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div data-layout-role="page-skeleton-shell">
				<div data-layout-role="page-skeleton-body">
					<header data-layout-role="page-skeleton-heading">
						<span data-skeleton-line="" aria-hidden className="w-24">
							<SkeletonText type="heading" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-96 max-w-full">
							<SkeletonText type="body" />
						</span>
					</header>
					<div aria-hidden data-layout-role="page-skeleton-section">
						<span data-skeleton-line="" aria-hidden className="w-80 max-w-full">
							<SkeletonText type="body" />
						</span>
						<span
							data-skeleton-box=""
							aria-hidden
							className="h-48 w-full rounded-shell"
						>
							<Skeleton fill />
						</span>
					</div>
					<div data-layout-role="page-skeleton-section">
						<div data-layout-role="page-skeleton-toolbar">
							<span
								data-skeleton-box=""
								aria-hidden
								className="h-(--control-sm) w-56 rounded-pill"
							>
								<Skeleton fill />
							</span>
							<span
								data-skeleton-box=""
								aria-hidden
								className="h-(--control-sm) w-36 rounded-pill"
							>
								<Skeleton fill />
							</span>
						</div>
						<RuleGridSkeleton />
					</div>
				</div>
			</div>
		</DashboardLayout>
	);
}
