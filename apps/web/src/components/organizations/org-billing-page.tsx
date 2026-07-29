import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Skeleton } from "#/components/ui/skeleton";

export function OrgBillingPage() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>billing</CardTitle>
				<CardDescription>
					billing lands with autumn — nothing to configure yet.
				</CardDescription>
			</CardHeader>
		</Card>
	);
}

export function OrgBillingPageSkeleton() {
	return <Skeleton className="h-24 rounded-xl" />;
}
