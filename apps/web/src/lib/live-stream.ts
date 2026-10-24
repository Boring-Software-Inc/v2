import { type LiveMessage, liveMessageSchema } from "@tripwire/contracts";
import { useSyncExternalStore } from "react";

type Handler = (data: string) => void;

const STREAM_URL = "/api/events/stream";
export const LIVE_RETRY_MS = 3000;

const handlers = new Map<string, Set<Handler>>();
const attached = new Set<string>();
const statusListeners = new Set<() => void>();
const resyncListeners = new Set<() => void>();
let source: EventSource | null = null;
let connected = false;
let lost = false;
let retry: ReturnType<typeof setTimeout> | null = null;

function resync() {
	for (const listener of resyncListeners) {
		listener();
	}
}

function onVisibility() {
	if (document.visibilityState === "visible") {
		resync();
	}
}

function busy(): boolean {
	return [...handlers.values()].some((set) => set.size > 0);
}

function setConnected(next: boolean) {
	if (connected === next) {
		return;
	}
	connected = next;
	for (const listener of statusListeners) {
		listener();
	}
}

function attach(event: string) {
	if (!source || attached.has(event)) {
		return;
	}
	attached.add(event);
	source.addEventListener(event, (message) => {
		for (const handler of handlers.get(event) ?? []) {
			handler(message.data);
		}
	});
}

function dropSource() {
	source?.close();
	source = null;
	attached.clear();
	setConnected(false);
}

function open() {
	if (source || retry || !("EventSource" in globalThis)) {
		return;
	}
	const next = new EventSource(STREAM_URL);
	if ("document" in globalThis) {
		document.addEventListener("visibilitychange", onVisibility);
	}
	source = next;
	next.onopen = () => {
		setConnected(true);
		if (lost) {
			lost = false;
			resync();
		}
	};
	next.onerror = () => {
		if (next.readyState === EventSource.OPEN) {
			return;
		}
		lost = true;
		setConnected(false);
		if (next.readyState === EventSource.CLOSED && source === next) {
			dropSource();
			retry = setTimeout(() => {
				retry = null;
				if (busy()) {
					open();
				}
			}, LIVE_RETRY_MS);
		}
	};
	next.addEventListener("heartbeat", () => setConnected(true));
	for (const event of handlers.keys()) {
		attach(event);
	}
}

function closeIfIdle() {
	if (busy()) {
		return;
	}
	if (retry) {
		clearTimeout(retry);
		retry = null;
	}
	if ("document" in globalThis) {
		document.removeEventListener("visibilitychange", onVisibility);
	}
	lost = false;
	dropSource();
}

/**
 * One EventSource for the whole tab, shared by every live view. It opens with
 * the first subscriber and closes with the last.
 */
export function subscribeLive(event: string, handler: Handler): () => void {
	const set = handlers.get(event) ?? new Set<Handler>();
	set.add(handler);
	handlers.set(event, set);
	open();
	attach(event);
	return () => {
		set.delete(handler);
		closeIfIdle();
	};
}

/**
 * Called when the stream may have missed messages: after a reconnect, and
 * when the tab comes back into view. Views refetch what they show.
 */
export function onLiveResync(listener: () => void): () => void {
	resyncListeners.add(listener);
	return () => {
		resyncListeners.delete(listener);
	};
}

function subscribeStatus(listener: () => void) {
	statusListeners.add(listener);
	return () => {
		statusListeners.delete(listener);
	};
}

export function useLiveConnected(): boolean {
	return useSyncExternalStore(
		subscribeStatus,
		() => connected,
		() => false,
	);
}

export function parseLive(data: string): LiveMessage | null {
	try {
		const parsed = liveMessageSchema.safeParse(JSON.parse(data));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
