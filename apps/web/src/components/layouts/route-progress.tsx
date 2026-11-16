import { useRouterState } from "@tanstack/react-router";
import { Progress } from "@tripwire/ui/progress";

export function RouteProgress() {
	const isLoading = useRouterState({ select: (state) => state.isLoading });
	return (
		<div className="relative h-0.5 shrink-0">
			{isLoading ? (
				<div className="absolute inset-x-0 top-0">
					<Progress
						ariaLabel="Loading page"
						showHeader={false}
						size="compact"
						value={null}
					/>
				</div>
			) : null}
		</div>
	);
}
