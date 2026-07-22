import { afterEach, describe, expect, test } from "bun:test";
import {
	getAnnouncementSnapshot,
	pushAnnouncement,
	resetAnnouncerForTest,
} from "./toast-announcer";
import {
	announcementFor,
	contentKey,
	createToastController,
	DEFAULT_DURATION_MS,
	EXIT_MS,
	type ToastCardState,
	type ToastControllerDeps,
} from "./toast-controller";

/** A controller wired to a fake clock and spy effects — the whole dedupe /
 * live-window contract is observable without a DOM or real timers. */
function harness(over: Partial<ToastControllerDeps> = {}) {
	const renders: ToastCardState[] = [];
	const dismisses: string[] = [];
	const announcements: string[] = [];
	let now = 0;
	let nextHandle = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();

	const controller = createToastController({
		render: (state) => renders.push({ ...state }),
		dismiss: (id) => dismisses.push(id),
		schedule: (fn, ms) => {
			const handle = nextHandle++;
			timers.set(handle, { at: now + ms, fn });
			return handle;
		},
		cancel: (handle) => {
			timers.delete(handle as number);
		},
		announce: (text) => announcements.push(text),
		...over,
	});

	function advance(ms: number) {
		const target = now + ms;
		// Fire timers in chronological order, moving the clock to each timer's
		// fire time first — so a timer that schedules a follow-up (dismiss →
		// removal) stamps it relative to when it actually ran, like real timers.
		while (true) {
			const next = [...timers]
				.filter(([, t]) => t.at <= target)
				.sort((a, b) => a[1].at - b[1].at)[0];
			if (!next) {
				break;
			}
			timers.delete(next[0]);
			now = next[1].at;
			next[1].fn();
		}
		now = target;
	}

	return { controller, renders, dismisses, announcements, advance };
}

const last = <T>(xs: T[]): T => xs[xs.length - 1];

describe("contentKey", () => {
	test("same content hashes equal; a different field splits", () => {
		expect(contentKey({ title: "saved" })).toBe(contentKey({ title: "saved" }));
		expect(contentKey({ title: "saved", status: "success" })).not.toBe(
			contentKey({ title: "saved", status: "error" }),
		);
		expect(contentKey({ title: "a" })).not.toBe(contentKey({ title: "b" }));
	});
});

describe("dedupe by content", () => {
	test("an identical re-fire re-highlights one card with a climbing count", () => {
		const h = harness();
		h.controller.fire({ title: "changes saved" });
		h.controller.fire({ title: "changes saved" });
		h.controller.fire({ title: "changes saved" });
		expect(h.controller.size()).toBe(1);
		expect(last(h.renders).count).toBe(3);
	});

	test("distinct content stacks as separate cards", () => {
		const h = harness();
		h.controller.fire({ title: "saved" });
		h.controller.fire({ title: "deleted" });
		expect(h.controller.size()).toBe(2);
	});
});

describe("dedupeKey override", () => {
	test("same key groups content that would otherwise split", () => {
		const h = harness();
		h.controller.fire({ title: "attempt 1", dedupeKey: "save" });
		h.controller.fire({ title: "attempt 2", dedupeKey: "save" });
		expect(h.controller.size()).toBe(1);
		expect(last(h.renders).count).toBe(2);
	});

	test("different keys split content that would otherwise group", () => {
		const h = harness();
		h.controller.fire({ title: "saved", dedupeKey: "row-a" });
		h.controller.fire({ title: "saved", dedupeKey: "row-b" });
		expect(h.controller.size()).toBe(2);
	});
});

describe("live window", () => {
	test("an identical fire AFTER full dismissal is a fresh count-1 toast", () => {
		const h = harness();
		h.controller.fire({ title: "saved" });
		// past the dismiss timer AND the exit window — fully gone.
		h.advance(DEFAULT_DURATION_MS + EXIT_MS + 1);
		expect(h.controller.size()).toBe(0);
		h.controller.fire({ title: "saved" });
		expect(last(h.renders).count).toBe(1);
	});

	test("a re-fire mid-exit re-highlights the fading toast, not a duplicate", () => {
		const h = harness();
		const id = h.controller.fire({ title: "saved" });
		// cross the dismiss timer → exit begins, but stay inside the exit window.
		h.advance(DEFAULT_DURATION_MS);
		expect(h.dismisses).toEqual([id]);
		h.controller.fire({ title: "saved" });
		// same single entry, revived with the climbed count — never a second card.
		expect(h.controller.size()).toBe(1);
		expect(last(h.renders).count).toBe(2);
	});
});

describe("timer ownership", () => {
	test("a re-fire refreshes the dismiss timer — a burst never vanishes mid-way", () => {
		const h = harness();
		h.controller.fire({ title: "saving…" });
		// almost expired…
		h.advance(DEFAULT_DURATION_MS - 1);
		expect(h.dismisses).toEqual([]);
		// …re-fire refreshes the clock.
		h.controller.fire({ title: "saving…" });
		// the OLD deadline passes with no dismissal (timer was re-armed).
		h.advance(DEFAULT_DURATION_MS - 1);
		expect(h.dismisses).toEqual([]);
		// only the refreshed deadline dismisses.
		h.advance(1);
		expect(h.dismisses.length).toBe(1);
	});

	test("a user dismiss drops the entry so the next identical fire is fresh", () => {
		const h = harness();
		const id = h.controller.fire({ title: "saved" });
		h.controller.handleDismiss(id);
		expect(h.controller.size()).toBe(0);
		h.controller.fire({ title: "saved" });
		expect(last(h.renders).count).toBe(1);
	});
});

describe("count badge", () => {
	test("count starts at 1 and climbs — the card shows the badge from 2", () => {
		const h = harness();
		h.controller.fire({ title: "x" });
		expect(last(h.renders).count).toBe(1);
		h.controller.fire({ title: "x" });
		expect(last(h.renders).count).toBe(2);
	});
});

describe("accessibility — the repeat is spoken", () => {
	test("the first fire is NOT announced by the controller (sonner covers it)", () => {
		const h = harness();
		h.controller.fire({ title: "saved", status: "success" });
		expect(h.announcements).toEqual([]);
	});

	test("announcementFor bakes the count into the spoken string from 2", () => {
		const state: ToastCardState = {
			id: "k",
			status: "success",
			variant: "single",
			title: "changes saved",
			count: 2,
			bump: 1,
		};
		expect(announcementFor(state)).toBe("success: changes saved (2)");
	});
});

describe("accessibility — reaches the aria-live region content", () => {
	afterEach(() => resetAnnouncerForTest());

	test("a re-fire writes the count-bearing text to the live region", () => {
		// Wire the controller's announce to the REAL announcer store so this
		// asserts the aria-live region CONTENT, not just internal count state.
		const h = harness({ announce: (text) => pushAnnouncement(text) });
		h.controller.fire({ title: "changes saved", status: "success" });
		// first fire: sonner speaks it, the region is untouched.
		expect(getAnnouncementSnapshot().text).toBe("");
		h.controller.fire({ title: "changes saved", status: "success" });
		expect(getAnnouncementSnapshot().text).toBe("success: changes saved (2)");
		expect(getAnnouncementSnapshot().seq).toBe(1);
	});
});
