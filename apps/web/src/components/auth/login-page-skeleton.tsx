export function LoginPageSkeleton() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-xs flex-col items-center gap-5">
				<div className="size-9 animate-pulse rounded-md bg-surface-1" />
				<div className="h-4 w-40 animate-pulse rounded bg-surface-1" />
				<div className="mt-3 h-9 w-full animate-pulse rounded-md bg-surface-1" />
			</div>
		</div>
	);
}
