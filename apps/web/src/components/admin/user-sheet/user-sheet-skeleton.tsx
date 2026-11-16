import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { Subheading } from "@tripwire/ui/typography";

export function UserSheetSkeleton() {
	return (
		<div data-layout-role="user-sheet-skeleton">
			<Subheading data-layout-role="user-sheet-skeleton-title">
				Loading user details
			</Subheading>
			<div data-layout-role="user-sheet-skeleton-identity">
				<span
					data-skeleton-box=""
					aria-hidden
					data-layout-role="user-sheet-skeleton-avatar"
				>
					<Skeleton fill />
				</span>
				<div data-layout-role="user-sheet-skeleton-copy">
					<span data-skeleton-line="" aria-hidden data-layout-size="user-name">
						<SkeletonText type="heading-sm" />
					</span>
					<span data-skeleton-line="" aria-hidden data-layout-size="user-email">
						<SkeletonText type="body-sm" />
					</span>
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
