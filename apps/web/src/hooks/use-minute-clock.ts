import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

export interface MinuteClockEnv {
	now: () => number;
	setTimer: (fn: () => void, ms: number) => void;
	clearTimer: () => void;
	onVisible: (fn: () => void) => () => void;
}

export interface MinuteClock {
	snapshot: () => number;
	subscribe: (listener: () => void) => () => void;
}

function sameMinute(a: number, b: number): boolean {
	return Math.floor(a / MINUTE) === Math.floor(b / MINUTE);
}

export function createMinuteClock(env: MinuteClockEnv): MinuteClock {
	const listeners = new Set<() => void>();
	let current = env.now();
	let stopWatching: (() => void) | undefined;

	const snapshot = () => {
		const now = env.now();
		if (!sameMinute(now, current)) {
			current = now;
		}
		return current;
	};

	const tick = () => {
		snapshot();
		for (const listener of listeners) {
			listener();
		}
		schedule();
	};

	function schedule() {
		env.clearTimer();
		env.setTimer(tick, MINUTE - (env.now() % MINUTE) + 50);
	}

	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		if (listeners.size === 1) {
			schedule();
			stopWatching = env.onVisible(tick);
		}
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) {
				env.clearTimer();
				stopWatching?.();
				stopWatching = undefined;
			}
		};
	};

	return { snapshot, subscribe };
}

let timer: ReturnType<typeof setTimeout> | undefined;

const browserClock = createMinuteClock({
	now: () => Date.now(),
	setTimer: (fn, ms) => {
		timer = setTimeout(fn, ms);
	},
	clearTimer: () => clearTimeout(timer),
	onVisible: (fn) => {
		const onChange = () => {
			if (document.visibilityState === "visible") {
				fn();
			}
		};
		document.addEventListener("visibilitychange", onChange);
		window.addEventListener("pageshow", onChange);
		return () => {
			document.removeEventListener("visibilitychange", onChange);
			window.removeEventListener("pageshow", onChange);
		};
	},
});

export function useMinuteClock(): Date {
	return new Date(
		useSyncExternalStore(
			browserClock.subscribe,
			browserClock.snapshot,
			browserClock.snapshot,
		),
	);
}
