import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Skeleton } from "#/components/ui/skeleton";

export function InvitePageSkeleton() {
	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col items-center gap-6">
				<TripwireLogo className="text-foreground" size={28} />
				<div className="flex w-full flex-col items-center gap-2.5">
					<Skeleton className="h-5 w-56" />
					<Skeleton className="h-4 w-72" />
					<Skeleton className="mt-2 h-8 w-24" />
				</div>
			</div>
		</div>
	);
}
