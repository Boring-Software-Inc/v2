import { BrandLockup } from "#/components/auth/brand-lockup";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { SlowRegion } from "#/components/glaze/ui/slow-notice";

const CELL_SLOTS = ["a", "b", "c", "d"] as const;

/** Mirrors the login card exactly — same lockup, same 2×2 forge grid, same
 * disclosure row — so nothing reflows when the real buttons land. */
export function LoginPageSkeleton() {
	return (
		<div className="relative flex min-h-dvh flex-col items-center justify-center bg-page px-4 pt-10 pb-40">
			<SlowRegion>
				<div
					aria-hidden
					className="flex w-full max-w-sm flex-col items-center gap-6"
				>
					<BrandLockup />

					<div className="flex flex-col items-center gap-1">
						<SkeletonText className="w-56" type="heading" />
						<SkeletonText className="w-64" type="body" />
					</div>

					<Card className="w-full">
						<CardContent>
							<div className="flex flex-col gap-2">
								<div className="grid grid-cols-2 gap-2">
									{CELL_SLOTS.map((slot) => (
										<Skeleton
											className="h-(--control) rounded-pill"
											key={slot}
										/>
									))}
								</div>
								<SkeletonText className="w-48" type="caption" />
							</div>
							<Skeleton className="h-(--control) w-44 rounded-pill" />
						</CardContent>
					</Card>
				</div>
			</SlowRegion>
		</div>
	);
}
