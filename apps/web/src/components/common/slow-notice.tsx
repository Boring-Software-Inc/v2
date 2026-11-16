"use client";

import { notify } from "@tripwire/ui/toast";
import { useEffect, useState } from "react";

export const SLOW_NOTICE = "This is taking abnormally long to process.";

const SLOW_AFTER_MS = 5000;
const SLOW_TOAST_ID = "slow-wait";
const listeners = new Set<() => void>();
let activeWaits = 0;
let toastShown = false;

function emit() {
	for (const listener of listeners) listener();
}

function markSlowWait() {
	activeWaits += 1;
	emit();
	return () => {
		activeWaits -= 1;
		emit();
	};
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

subscribe(() => {
	const waiting = activeWaits > 0;
	if (waiting === toastShown) return;
	toastShown = waiting;
	if (waiting) {
		notify.show({
			duration: "persistent",
			id: SLOW_TOAST_ID,
			title: SLOW_NOTICE,
		});
		return;
	}
	notify.dismiss(SLOW_TOAST_ID);
});

function useSlowAfter(active: boolean) {
	const [slow, setSlow] = useState(false);

	useEffect(() => {
		if (!active) {
			setSlow(false);
			return;
		}
		const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [active]);

	return active && slow;
}

export function useSlowWait(active: boolean) {
	const slow = useSlowAfter(active);
	useEffect(() => (slow ? markSlowWait() : undefined), [slow]);
}
