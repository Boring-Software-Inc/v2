import { type LiveMessage, liveMessageSchema } from "@tripwire/contracts";
import { useSyncExternalStore } from "react";

type Handler = (data: string) => void;

const STREAM_URL = "/api/events/stream";

const handlers = new Map<string, Set<Handler>>();
const attached = new Set<string>();
const statusListeners = new Set<() => void>();
let source: EventSource | null = null;
let connected = false;

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

function open() {
	if (source || typeof EventSource === "undefined") {
		return;
	}
	const next = new EventSource(STREAM_URL);
	source = next;
	next.onopen = () => setConnected(true);
	next.onerror = () => setConnected(next.readyState === EventSource.OPEN);
	next.addEventListener("heartbeat", () => setConnected(true));
	for (const event of handlers.keys()) {
		attach(event);
	}
}

function closeIfIdle() {
	const busy = [...handlers.values()].some((set) => set.size > 0);
	if (busy || !source) {
		return;
	}
	source.close();
	source = null;
	attached.clear();
	setConnected(false);
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
