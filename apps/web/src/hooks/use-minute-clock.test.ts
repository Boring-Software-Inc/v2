import { describe, expect, test } from "bun:test";
import { createMinuteClock } from "#/hooks/use-minute-clock";

const MINUTE = 60_000;

function fakeEnv(start: number) {
	let now = start;
	let timer: { fn: () => void; at: number } | null = null;
	const visible = new Set<() => void>();
	return {
		env: {
			now: () => now,
			setTimer: (fn: () => void, ms: number) => {
				timer = { fn, at: now + ms };
			},
			clearTimer: () => {
				timer = null;
			},
			onVisible: (fn: () => void) => {
				visible.add(fn);
				return () => visible.delete(fn);
			},
		},
		hide: (ms: number) => {
			now += ms;
		},
		show: () => {
			for (const fn of visible) {
				fn();
			}
		},
		runTimer: () => {
			const due = timer;
			if (due) {
				now = Math.max(now, due.at);
				due.fn();
			}
		},
		listening: () => visible.size,
	};
}

describe("the minute clock", () => {
	const START = Date.UTC(2026, 9, 24, 1, 0, 10);

	test("a minute boundary tells every listener", () => {
		const fake = fakeEnv(START);
		const clock = createMinuteClock(fake.env);
		let calls = 0;
		clock.subscribe(() => calls++);
		fake.runTimer();
		expect(calls).toBe(1);
		expect(clock.snapshot()).toBeGreaterThanOrEqual(START + MINUTE - 10_000);
	});

	test("a tab back from hidden ticks at once, before any timer", () => {
		const fake = fakeEnv(START);
		const clock = createMinuteClock(fake.env);
		let calls = 0;
		clock.subscribe(() => calls++);
		fake.hide(5 * MINUTE);
		fake.show();
		expect(calls).toBe(1);
		expect(clock.snapshot()).toBe(START + 5 * MINUTE);
	});

	test("a read after a hidden stretch is never the old minute", () => {
		const fake = fakeEnv(START);
		const clock = createMinuteClock(fake.env);
		clock.subscribe(() => undefined);
		const before = clock.snapshot();
		fake.hide(3 * MINUTE);
		expect(clock.snapshot()).toBe(before + 3 * MINUTE);
	});

	test("the same minute keeps the same value, so React does not re-render", () => {
		const fake = fakeEnv(START);
		const clock = createMinuteClock(fake.env);
		const first = clock.snapshot();
		fake.hide(20_000);
		expect(clock.snapshot()).toBe(first);
	});

	test("the last listener leaving stops the timer and the visibility watch", () => {
		const fake = fakeEnv(START);
		const clock = createMinuteClock(fake.env);
		const stop = clock.subscribe(() => undefined);
		expect(fake.listening()).toBe(1);
		stop();
		expect(fake.listening()).toBe(0);
	});
});
