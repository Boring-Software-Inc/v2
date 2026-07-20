import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Skeleton } from "#/components/ui/skeleton";

export function InstallSetupPageSkeleton() {
	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col items-center gap-5">
				<TripwireLogo className="text-foreground" size={28} />
				<Skeleton className="h-5 w-64" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-8 w-40" />
			</div>
		</div>
	);
}
