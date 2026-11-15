import { Skeleton } from "@tripwire/ui/skeleton";

export function RunnerPageSkeleton() {
	return (
		<main
			aria-hidden
			className="grid min-h-dvh place-items-center bg-page px-4 py-10"
		>
			<span
				data-skeleton-box=""
				aria-hidden
				className="min-h-72 w-full max-w-xl rounded-shell"
			>
				<Skeleton fill />
			</span>
		</main>
	);
}
