import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";

const CELL_SLOTS = ["a", "b", "c", "d"] as const;

/** Mirrors the login card exactly — same lockup, same 2×2 forge grid, same
 * disclosure row — so nothing reflows when the real buttons land. */
export function LoginPageSkeleton() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-page px-4 py-10">
			<div aria-hidden className="flex w-full max-w-sm flex-col gap-6">
				<div className="flex items-center gap-2">
					<TripwireWordmark
						className="shrink-0 text-text-1"
						height={20}
						width={32}
					/>
					<span className="type-heading">Tripwire</span>
				</div>

				<div className="flex flex-col gap-1">
					<SkeletonText className="w-40" type="heading" />
					<SkeletonText className="w-64" type="body" />
				</div>

				<Card>
					<CardContent>
						<div className="grid grid-cols-2 gap-2">
							{CELL_SLOTS.map((slot) => (
								<Skeleton className="h-(--control) rounded-pill" key={slot} />
							))}
						</div>
						<Skeleton className="h-(--control) w-44 rounded-pill" />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
