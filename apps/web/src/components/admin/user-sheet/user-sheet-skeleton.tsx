import { SheetTitle } from "#/design-system/ui/sheet";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

export function UserSheetSkeleton() {
	return (
		<div data-layout-role="user-sheet-skeleton">
			<SheetTitle data-layout-role="user-sheet-skeleton-title">
				Loading user details
			</SheetTitle>
			<div data-layout-role="user-sheet-skeleton-identity">
				<Skeleton data-layout-role="user-sheet-skeleton-avatar" />
				<div data-layout-role="user-sheet-skeleton-copy">
					<SkeletonText data-layout-size="user-name" type="heading-sm" />
					<SkeletonText data-layout-size="user-email" type="body-sm" />
				</div>
			</div>
			<div data-layout-role="user-sheet-skeleton-body">
				{["Access", "Flags", "Account", "Moderation", "Activity"].map(
					(section) => (
						<div data-layout-role="user-sheet-skeleton-section" key={section}>
							<SkeletonText type="heading-sm" />
							<SkeletonText lines={3} type="body-sm" />
						</div>
					),
				)}
			</div>
		</div>
	);
}
