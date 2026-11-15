import { Card, CardContent } from "@tripwire/ui/card";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";

const CONTROL_SLOTS = ["events", "face", "motion", "behaviour"] as const;

export function MascotPageSkeleton() {
	return (
		<div className="min-h-dvh bg-page text-text-1">
			<main
				aria-hidden
				className="mx-auto flex w-full max-w-288 flex-col gap-6 px-4 py-8"
			>
				<span data-skeleton-line="" aria-hidden className="w-40">
					<SkeletonText type="heading" />
				</span>
				<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
					<div className="flex min-w-0 flex-1 flex-col gap-6">
						<Card>
							<CardContent>
								<span
									data-skeleton-box=""
									aria-hidden
									className="min-h-96 w-full rounded-panel"
								>
									<Skeleton fill />
								</span>
							</CardContent>
						</Card>
					</div>
					<div className="flex w-full flex-col gap-4 lg:w-96 lg:shrink-0">
						{CONTROL_SLOTS.map((slot) => (
							<span
								data-skeleton-box=""
								aria-hidden
								className="h-40 w-full rounded-shell"
								key={slot}
							>
								<Skeleton fill />
							</span>
						))}
					</div>
				</div>
			</main>
		</div>
	);
}
