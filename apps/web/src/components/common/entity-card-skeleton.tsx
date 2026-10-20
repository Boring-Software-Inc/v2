import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import { SkeletonText } from "#/components/glaze/ui/skeleton";

export function EntityCardSkeleton({ body = false }: { body?: boolean }) {
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
		</Card>
	);
}
