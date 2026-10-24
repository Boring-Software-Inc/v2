import { SheetTitle } from "#/components/glaze/ui/sheet";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";

export function UserSheetSkeleton() {
	return (
		<div aria-busy className="flex flex-col">
			<SheetTitle className="sr-only">Loading user</SheetTitle>
			<div className="flex items-center gap-3 border-line-faint border-b px-4 py-5 sm:px-6">
				<Skeleton className="size-10 rounded-pill" />
				<div className="flex flex-1 flex-col gap-2">
					<Skeleton className="h-4 w-40" />
					<Skeleton className="h-3 w-56" />
				</div>
			</div>
			<div className="flex flex-col gap-8 px-4 py-6 sm:px-6">
				<SkeletonText lines={4} type="body-sm" />
				<SkeletonText lines={3} type="body-sm" />
				<SkeletonText lines={3} type="body-sm" />
			</div>
		</div>
	);
}
