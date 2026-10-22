import { useMemo, useSyncExternalStore } from "react";
import {
	DEV_APPLIED_STORAGE_KEY,
	DEV_PANEL_STORAGE_KEY,
	type DevAppliedState,
	type DevPanelState,
	findMatchingPreset,
	parseAppliedState,
	parsePanelState,
} from "#/lib/dev/scenario-panel";
import {
	DEV_LATENCY_COOKIE,
	type DevAxis,
	type DevLatency,
	type DevScenario,
	transitionScenario,
} from "#/lib/dev/scenarios";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	window.addEventListener("storage", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", listener);
	};
}

function write(key: string, value: DevPanelState | DevAppliedState): void {
	window.localStorage.setItem(key, JSON.stringify(value));
	for (const listener of listeners) {
		listener();
	}
}

function useStored(key: string): string | null {
	return useSyncExternalStore(
		subscribe,
		() => window.localStorage.getItem(key),
		() => null,
	);
}

export async function writeLatencyCookie(latency: DevLatency): Promise<void> {
	if (latency === 0) {
		await window.cookieStore.delete({ name: DEV_LATENCY_COOKIE, path: "/" });
		return;
	}
	await window.cookieStore.set({
		name: DEV_LATENCY_COOKIE,
		value: String(latency),
		path: "/",
	});
}

export function useDevScenario() {
	const panelRaw = useStored(DEV_PANEL_STORAGE_KEY);
	const appliedRaw = useStored(DEV_APPLIED_STORAGE_KEY);
	const state = useMemo(() => parsePanelState(panelRaw), [panelRaw]);
	const applied = useMemo(() => parseAppliedState(appliedRaw), [appliedRaw]);
	const match = useMemo(() => findMatchingPreset(state), [state]);

	function setAxis<A extends DevAxis>(axis: A, value: DevScenario[A]): void {
		write(DEV_PANEL_STORAGE_KEY, {
			...state,
			scenario: transitionScenario(state.scenario, axis, value),
		});
	}

	async function setLatency(latency: DevLatency): Promise<void> {
		write(DEV_PANEL_STORAGE_KEY, { ...state, latency });
		await writeLatencyCookie(latency);
	}

	function commit(next: DevAppliedState): void {
		write(DEV_PANEL_STORAGE_KEY, {
			scenario: next.scenario,
			latency: next.latency,
		});
		write(DEV_APPLIED_STORAGE_KEY, next);
	}

	return {
		scenario: state.scenario,
		latency: state.latency,
		match,
		applied,
		setAxis,
		setLatency,
		commit,
	};
}
