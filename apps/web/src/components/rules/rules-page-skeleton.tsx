import { Card, CardFooter } from "#/components/glaze/ui/card";
import { Panel } from "#/components/glaze/ui/panel";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	RULE_CARD_CLASS,
	RULE_FOOTER_CLASS,
	RULE_HEADER_CLASS,
	RULE_PANEL_CLASS,
} from "#/components/rules/rule-card-frame";
import { cn } from "#/lib/glaze/utils";

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
		<div aria-hidden className="grid items-stretch gap-3 sm:grid-cols-2">
			{RULE_SLOTS.map((slot) => (
				<Card className={RULE_CARD_CLASS} key={slot.key}>
					<Panel className={RULE_PANEL_CLASS}>
						<div className={RULE_HEADER_CLASS}>
							<SkeletonText
								className={cn(slot.name, "type-label-lg")}
								type="label"
							/>
							<Skeleton className="ms-auto h-4 w-7 shrink-0 rounded-pill" />
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
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-24" type="heading" />
						<SkeletonText className="w-96 max-w-full" type="body" />
					</header>
					<div aria-hidden className="flex flex-col gap-3">
						<SkeletonText className="w-80 max-w-full" type="body" />
						<Skeleton className="h-48 w-full rounded-shell" />
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between gap-3">
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
