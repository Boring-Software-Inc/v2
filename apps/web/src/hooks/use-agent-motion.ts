import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void) {
	const media = window.matchMedia?.(QUERY);
	media?.addEventListener("change", listener);
	return () => media?.removeEventListener("change", listener);
}

function osReduced(): boolean {
	return window.matchMedia?.(QUERY).matches ?? false;
}

export type AgentMotion = "full" | "reduced";

/** Agent animations run unless the OS or the account setting asks for less. */
export function useAgentMotion(): AgentMotion {
	const { data } = useQuery(sessionInfoQueryOptions());
	const os = useSyncExternalStore(subscribe, osReduced, () => false);
	return os || data?.user?.reduceAgentMotion ? "reduced" : "full";
}
