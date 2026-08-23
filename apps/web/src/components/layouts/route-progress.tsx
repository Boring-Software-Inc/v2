import { useRouterState } from "@tanstack/react-router";

/**
 * A thin top progress bar shown while the router loads the next route. TanStack
 * runs a route's loaders BEFORE rendering the new page, so without this a click
 * feels dead until the destination pops in. Sits under the header and takes no
 * layout space when idle. A blue segment sweeps across (indeterminate — we don't
 * know how long a loader takes).
 */
export function RouteProgress() {
	const isLoading = useRouterState({ select: (state) => state.isLoading });
	return (
		<>
			<div aria-hidden className="relative h-0.5 shrink-0 overflow-hidden">
				{isLoading ? (
					<div className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-blue-500 [animation:route-progress_1.1s_ease-in-out_infinite]" />
				) : null}
			</div>
			{/* The bar is the sighted cue; this is its spoken pair. The region is
			    always mounted so the text swap actually announces — a live region
			    inserted at the same time as its content often does not. */}
			<div aria-live="polite" className="sr-only">
				{isLoading ? "Loading page" : ""}
			</div>
		</>
	);
}
