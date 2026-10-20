import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { SkeletonText } from "#/components/glaze/ui/skeleton";

export function OrgBillingPage() {
	return (
		<Empty variant="plain">
			<EmptyHeader>
				<EmptyTitle>Nothing to configure yet</EmptyTitle>
				<EmptyDescription>Billing is not available yet.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

export function OrgBillingPageSkeleton() {
	return (
		<div aria-hidden className="flex flex-col items-center gap-1">
			<SkeletonText className="w-40" type="label" />
			<SkeletonText className="w-48" type="body-sm" />
		</div>
	);
}
