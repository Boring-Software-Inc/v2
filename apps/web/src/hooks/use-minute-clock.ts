import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;

function sameMinute(a: number, b: number): boolean {
	return Math.floor(a / MINUTE) === Math.floor(b / MINUTE);
}

function snapshot(): number {
	const now = Date.now();
	if (!sameMinute(now, current)) {
		current = now;
	}
	return current;
}

function schedule() {
	clearTimeout(timer);
	timer = setTimeout(tick, MINUTE - (Date.now() % MINUTE) + 50);
}

function tick() {
	snapshot();
	for (const listener of listeners) {
		listener();
	}
	schedule();
}

function onVisibility() {
	if (document.visibilityState === "visible") {
		tick();
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (listeners.size === 1) {
		schedule();
		document.addEventListener("visibilitychange", onVisibility);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibility);
		}
	};
}

export function useMinuteClock(): Date {
	return new Date(useSyncExternalStore(subscribe, snapshot, snapshot));
}
