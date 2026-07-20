import { Skeleton } from "#/components/ui/skeleton";

export function NoOrgsPageSkeleton() {
	return (
		<div className="flex min-h-dvh items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col gap-5 rounded-xl bg-card px-6 py-6">
				<div className="flex items-center gap-3">
					<Skeleton className="size-10 rounded-md" />
					<div className="flex flex-col gap-1.5">
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-52" />
					</div>
				</div>
				<Skeleton className="h-9 w-full rounded-md" />
				<Skeleton className="h-9 w-full rounded-md" />
				<Skeleton className="h-8 w-full rounded-md" />
			</div>
		</div>
	);
}
