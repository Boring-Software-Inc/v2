import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";

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
		<Card aria-hidden className="h-full">
			<CardHeader>
				<CardTitle>
					<SkeletonText className="w-48" type="label" />
				</CardTitle>
				<SkeletonText className="col-start-1 w-64" type="body-sm" />
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
							<Skeleton
								className={`h-(--control-sm) rounded-pill ${slot.width}`}
								key={slot.key}
							/>
						))}
					</div>
				</CardFooter>
			) : null}
		</Card>
	);
}
