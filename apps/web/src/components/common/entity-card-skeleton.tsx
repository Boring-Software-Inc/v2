import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@tripwire/ui/card";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";

const CHIN_SLOTS = [
	{ key: "a", width: "w-26" },
	{ key: "b", width: "w-18" },
	{ key: "c", width: "w-25" },
	{ key: "d", width: "w-21" },
	{ key: "e", width: "w-23" },
] as const;

export function EntityCardSkeleton({
	body = false,
	chin = false,
}: {
	body?: boolean;
	chin?: boolean;
}) {
	return (
		<Card aria-hidden data-layout-role="entity-card-skeleton">
			<CardHeader>
				<CardTitle>
					<span data-skeleton-line="" aria-hidden className="w-48">
						<SkeletonText type="label" />
					</span>
				</CardTitle>
				<span data-skeleton-line="" aria-hidden className="col-start-1 w-64">
					<SkeletonText type="body-sm" />
				</span>
			</CardHeader>
			{body ? (
				<CardContent>
					<SkeletonText lines={2} type="body-sm" />
				</CardContent>
			) : null}
			{chin ? (
				<CardFooter>
					<div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
						{CHIN_SLOTS.map((slot) => (
							<span
								data-skeleton-box=""
								aria-hidden
								className={`h-(--control-sm) rounded-pill ${slot.width}`}
								key={slot.key}
							>
								<Skeleton fill />
							</span>
						))}
					</div>
				</CardFooter>
			) : null}
		</Card>
	);
}
