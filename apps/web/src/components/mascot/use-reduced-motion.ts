import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void) {
	const query = window.matchMedia(QUERY);
	query.addEventListener("change", listener);
	return () => query.removeEventListener("change", listener);
}

export function useReducedMotion() {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(QUERY).matches,
		() => false,
	);
}
