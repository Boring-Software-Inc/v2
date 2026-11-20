import { Card, CardContent } from "@tripwire/ui/card";
import { Icon, Pending } from "@tripwire/ui/icon";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const LOCAL_APPEARANCE = {
	node34_1:
		"grid min-h-0 flex-1 grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)] overflow-hidden bg-shell",
	node39_2: "min-h-0 overflow-hidden border-e border-line-faint bg-shell",
	node42_3: "flex h-12 items-center border-b border-line-faint px-3",
	node43_4: "h-8 w-64 max-w-full rounded-pill",
	node45_5: "flex flex-col gap-3 px-4 py-5",
	node46_6: "flex items-start gap-3 px-3",
	node47_7: "min-w-0 flex-1",
	node48_8: "w-32",
	node49_9: "mt-0.5 w-52",
	node51_10: "h-(--control-sm) w-24 rounded-pill",
	node53_11: "flex items-center gap-3 px-3 py-2",
	node54_12: "min-w-0 flex-1",
	node55_13: "w-28",
	node56_14: "w-48",
	node58_15: "h-5 w-8 rounded-pill",
	node62_16: "flex flex-col gap-1 p-1",
	node65_17: "flex min-h-14 items-center gap-3 px-3",
	node68_18: "size-4",
	node69_19: "min-w-0 flex-1",
	node70_20: "w-28",
	node72_21: "w-52 max-w-full",
	node83_22: "w-24",
	node84_23: "h-20 w-full rounded-panel",
	node90_24: "grid min-h-0 place-items-center bg-page text-text-3",
	node94_25: "sr-only",
	node103_26: "flex h-full min-h-0 flex-col overflow-hidden",
} as const;

const BLOCK_ROWS = ["headline", "rules", "link"] as const;

function SkeletonBox({ className }: { className: string }) {
	return (
		<span className={className}>
			<Skeleton fill />
		</span>
	);
}

function SkeletonLine({
	className,
	type,
}: {
	className: string;
	type: "heading-sm" | "body-sm" | "label" | "caption";
}) {
	return (
		<span className={className}>
			<SkeletonText type={type} />
		</span>
	);
}

export function BuilderSkeleton({
	forge = null,
}: {
	forge?: ForgeId | null;
} = {}) {
	return (
		<div
			aria-busy="true"
			className={LOCAL_APPEARANCE.node34_1}
			data-layout-role="responses-builder-skeleton"
		>
			<aside
				aria-hidden
				className={LOCAL_APPEARANCE.node39_2}
				data-layout-role="responses-editor-skeleton"
			>
				<div className={LOCAL_APPEARANCE.node42_3}>
					<SkeletonBox className={LOCAL_APPEARANCE.node43_4} />
				</div>
				<div className={LOCAL_APPEARANCE.node45_5}>
					<header className={LOCAL_APPEARANCE.node46_6}>
						<div className={LOCAL_APPEARANCE.node47_7}>
							<SkeletonLine
								className={LOCAL_APPEARANCE.node48_8}
								type="heading-sm"
							/>
							<SkeletonLine
								className={LOCAL_APPEARANCE.node49_9}
								type="body-sm"
							/>
						</div>
						<SkeletonBox className={LOCAL_APPEARANCE.node51_10} />
					</header>
					<div className={LOCAL_APPEARANCE.node53_11}>
						<div className={LOCAL_APPEARANCE.node54_12}>
							<SkeletonLine
								className={LOCAL_APPEARANCE.node55_13}
								type="label"
							/>
							<SkeletonLine
								className={LOCAL_APPEARANCE.node56_14}
								type="caption"
							/>
						</div>
						<SkeletonBox className={LOCAL_APPEARANCE.node58_15} />
					</div>
					<Card>
						<CardContent flush>
							<div className={LOCAL_APPEARANCE.node62_16}>
								{BLOCK_ROWS.map((row) => (
									<div className={LOCAL_APPEARANCE.node65_17} key={row}>
										<SkeletonBox className={LOCAL_APPEARANCE.node68_18} />
										<div className={LOCAL_APPEARANCE.node69_19}>
											<SkeletonLine
												className={LOCAL_APPEARANCE.node70_20}
												type="label"
											/>
											<SkeletonLine
												className={LOCAL_APPEARANCE.node72_21}
												type="caption"
											/>
										</div>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent>
							<SkeletonLine
								className={LOCAL_APPEARANCE.node83_22}
								type="heading-sm"
							/>
							<SkeletonBox className={LOCAL_APPEARANCE.node84_23} />
						</CardContent>
					</Card>
				</div>
			</aside>
			<output
				className={LOCAL_APPEARANCE.node90_24}
				data-layout-role="responses-preview-loader"
			>
				<Icon icon={Pending} motion="spin" />
				<span className={LOCAL_APPEARANCE.node94_25}>
					{forge
						? `Loading ${FORGE_BY_ID[forge].label} response preview`
						: "Loading response preview"}
				</span>
			</output>
		</div>
	);
}

export function ResponsesPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className={LOCAL_APPEARANCE.node103_26}>
				<BuilderSkeleton />
			</div>
		</DashboardLayout>
	);
}

import { FORGE_BY_ID, type ForgeId } from "@tripwire/contracts";
