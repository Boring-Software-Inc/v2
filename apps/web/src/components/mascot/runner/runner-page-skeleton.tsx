import { Skeleton } from "#/components/glaze/ui/skeleton";

export function RunnerPageSkeleton() {
	return (
		<main
			aria-hidden
			className="grid min-h-dvh place-items-center bg-page px-4 py-10"
		>
			<Skeleton className="min-h-72 w-full max-w-xl rounded-shell" />
		</main>
	);
}
