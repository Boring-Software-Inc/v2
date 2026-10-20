import { Link } from "@tanstack/react-router";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { MascotArt } from "#/components/mascot/mascot-art";

export function OrgBillingPage() {
	return (
		<Empty art={<MascotArt mood="billing-empty" />} variant="plain">
			<EmptyHeader>
				<EmptyTitle>No billing yet</EmptyTitle>
				<EmptyDescription>
					Tripwire has no plans or invoices to set up yet. Billing settings will
					appear here when they exist.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button
					nativeButton={false}
					render={
						<Link
							search={(prev: Record<string, unknown>) => ({
								...prev,
								settings: "members" as const,
							})}
							to="."
						/>
					}
					size="sm"
					variant="secondary"
				>
					View members
				</Button>
			</EmptyContent>
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
