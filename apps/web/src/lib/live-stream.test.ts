import { afterEach, beforeAll, describe, expect, jest, test } from "bun:test";
import { LIVE_RETRY_MS, onLiveResync, subscribeLive } from "#/lib/live-stream";

type Listener = (message: { data: string }) => void;

class FakeEventSource {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 2;
	static made: FakeEventSource[] = [];
	readyState = FakeEventSource.CONNECTING;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	listeners = new Map<string, Listener[]>();

	constructor(readonly url: string) {
		FakeEventSource.made.push(this);
	}

	addEventListener(event: string, listener: Listener) {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}

	close() {
		this.readyState = FakeEventSource.CLOSED;
	}

	open() {
		this.readyState = FakeEventSource.OPEN;
		this.onopen?.();
	}

	drop(state: number) {
		this.readyState = state;
		this.onerror?.();
	}

	emit(event: string, data: string) {
		for (const listener of this.listeners.get(event) ?? []) {
			listener({ data });
		}
	}
}

class FakeDocument extends EventTarget {
	visibilityState: "visible" | "hidden" = "visible";

	show(state: "visible" | "hidden") {
		this.visibilityState = state;
		this.dispatchEvent(new Event("visibilitychange"));
	}
}

const page = new FakeDocument();

function latest(): FakeEventSource {
	const source = FakeEventSource.made.at(-1);
	if (!source) {
		throw new Error("no stream opened");
	}
	return source;
}

function watch() {
	const messages: string[] = [];
	let resyncs = 0;
	const off = subscribeLive("agent", (data) => messages.push(data));
	const offResync = onLiveResync(() => {
		resyncs += 1;
	});
	return {
		messages,
		resyncs: () => resyncs,
		stop: () => {
			offResync();
			off();
		},
	};
}

beforeAll(() => {
	Object.assign(globalThis, { EventSource: FakeEventSource, document: page });
});

afterEach(() => {
	jest.useRealTimers();
	FakeEventSource.made = [];
	page.visibilityState = "visible";
});

describe("live stream recovery", () => {
	test("the first open does not resync; a reconnect does", () => {
		const view = watch();
		latest().open();
		expect(view.resyncs()).toBe(0);
		latest().drop(FakeEventSource.CONNECTING);
		expect(view.resyncs()).toBe(0);
		latest().open();
		expect(view.resyncs()).toBe(1);
		latest().emit("agent", "after");
		expect(view.messages).toEqual(["after"]);
		view.stop();
	});

	test("a stream the browser gave up on opens again and resyncs", () => {
		jest.useFakeTimers();
		const view = watch();
		const first = latest();
		first.open();
		first.drop(FakeEventSource.CLOSED);
		expect(FakeEventSource.made).toHaveLength(1);
		jest.advanceTimersByTime(LIVE_RETRY_MS);
		const second = latest();
		expect(second).not.toBe(first);
		second.open();
		expect(view.resyncs()).toBe(1);
		second.emit("agent", "again");
		expect(view.messages).toEqual(["again"]);
		view.stop();
	});

	test("no retry once the last view leaves", () => {
		jest.useFakeTimers();
		const view = watch();
		latest().drop(FakeEventSource.CLOSED);
		view.stop();
		jest.advanceTimersByTime(LIVE_RETRY_MS * 2);
		expect(FakeEventSource.made).toHaveLength(1);
	});

	test("a tab coming back resyncs; hiding it does not", () => {
		const view = watch();
		latest().open();
		page.show("hidden");
		expect(view.resyncs()).toBe(0);
		page.show("visible");
		expect(view.resyncs()).toBe(1);
		view.stop();
		page.show("hidden");
		page.show("visible");
		expect(view.resyncs()).toBe(1);
	});
});
