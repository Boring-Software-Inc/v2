import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	RULE_CARD_CLASS,
	RULE_FOOTER_CLASS,
	RULE_HEADER_CLASS,
	RULE_PANEL_CLASS,
} from "#/components/rules/rule-card-frame";
import { cn } from "#/design-system/lib/utils";
import { Card, CardFooter } from "#/design-system/ui/card";
import { Panel } from "#/design-system/ui/panel";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

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
				<Card className={RULE_CARD_CLASS} key={slot.key}>
					<Panel className={RULE_PANEL_CLASS}>
						<div className={RULE_HEADER_CLASS}>
							<SkeletonText
								className={cn(slot.name, "type-label-lg")}
								type="label"
							/>
							<Skeleton
								className="h-4 w-7 shrink-0 rounded-pill"
								data-layout-role="rules-skeleton-toggle"
							/>
						</div>
						<SkeletonText lines={2} type="body-sm" />
					</Panel>
					<CardFooter className={RULE_FOOTER_CLASS}>
						<SkeletonText className="w-14" type="label-sm" />
						<SkeletonText className="w-28" type="caption" />
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
						<SkeletonText className="w-24" type="heading" />
						<SkeletonText className="w-96 max-w-full" type="body" />
					</header>
					<div aria-hidden data-layout-role="page-skeleton-section">
						<SkeletonText className="w-80 max-w-full" type="body" />
						<Skeleton className="h-48 w-full rounded-shell" />
					</div>
					<div data-layout-role="page-skeleton-section">
						<div data-layout-role="page-skeleton-toolbar">
							<Skeleton className="h-(--control-sm) w-56 rounded-pill" />
							<Skeleton className="h-(--control-sm) w-36 rounded-pill" />
						</div>
						<RuleGridSkeleton />
					</div>
				</div>
			</div>
		</DashboardLayout>
	);
}
