import { useRouterState } from "@tanstack/react-router";
import { Progress } from "#/components/glaze/ui/progress";

export function RouteProgress() {
	const isLoading = useRouterState({ select: (state) => state.isLoading });
	return (
		<div className="relative h-0.5 shrink-0">
			{isLoading ? (
				<Progress
					aria-label="Loading page"
					className="absolute inset-x-0 top-0"
					size="sm"
					value={null}
				/>
			) : null}
		</div>
	);
}
