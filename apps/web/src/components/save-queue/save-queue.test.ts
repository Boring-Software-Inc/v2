import { describe, expect, test } from "bun:test";
import { nextPending, pendingAfterCommit } from "./save-queue-context.tsx";

const SAVED = { onSuccess: "ci-check", "blockComment.mode": "full" };

describe("save queue — pending transitions", () => {
	test("a change away from saved queues under its key", () => {
		const pending = nextPending({}, SAVED, "onSuccess", "silent", Object.is);
		expect(pending).toEqual({ onSuccess: "silent" });
	});

	test("a later change to the same key replaces the earlier", () => {
		const first = nextPending({}, SAVED, "onSuccess", "silent", Object.is);
		const second = nextPending(first, SAVED, "onSuccess", "comment", Object.is);
		expect(second).toEqual({ onSuccess: "comment" });
		expect(Object.keys(second)).toHaveLength(1);
	});

	test("toggling back to the saved value clears the key — no queued noop", () => {
		const dirty = nextPending({}, SAVED, "onSuccess", "silent", Object.is);
		const clean = nextPending(dirty, SAVED, "onSuccess", "ci-check", Object.is);
		expect(clean).toEqual({});
	});

	test("setting the saved value on a clean queue stays clean, same reference", () => {
		const prev = {};
		expect(nextPending(prev, SAVED, "onSuccess", "ci-check", Object.is)).toBe(
			prev,
		);
	});

	test("keys are independent — clearing one leaves the other queued", () => {
		let pending = nextPending({}, SAVED, "onSuccess", "silent", Object.is);
		pending = nextPending(
			pending,
			SAVED,
			"blockComment.mode",
			"custom",
			Object.is,
		);
		pending = nextPending(pending, SAVED, "onSuccess", "ci-check", Object.is);
		expect(pending).toEqual({ "blockComment.mode": "custom" });
	});

	test("injected equality: object-valued keys noop-clear with JSON equality", () => {
		const saved = { config: { minDays: 7 } };
		const jsonEqual = (a: unknown, b: unknown) =>
			JSON.stringify(a) === JSON.stringify(b);
		const dirty = nextPending({}, saved, "config", { minDays: 10 }, jsonEqual);
		expect(Object.keys(dirty)).toHaveLength(1);
		// Back to a structurally-equal object: Object.is would keep a phantom
		// change queued; the injected equality clears it (the rules-page case).
		expect(
			nextPending(dirty, saved, "config", { minDays: 7 }, jsonEqual),
		).toEqual({});
	});
});

describe("save queue — pending after commit", () => {
	const PENDING = { "a:enabled": false, "a:param:min": 3, "b:enabled": true };

	test("success clears everything", () => {
		expect(pendingAfterCommit(PENDING, { ok: true })).toEqual({});
	});

	test("bare failure keeps the whole queue", () => {
		expect(pendingAfterCommit(PENDING, { error: "nope" })).toBe(PENDING);
	});

	test("partial failure keeps ONLY the failed keys", () => {
		expect(
			pendingAfterCommit(PENDING, {
				error: "b did not save",
				failedKeys: ["b:enabled"],
			}),
		).toEqual({ "b:enabled": true });
	});

	test("failed keys not in pending are ignored", () => {
		expect(
			pendingAfterCommit(PENDING, {
				error: "gone",
				failedKeys: ["b:enabled", "c:enabled"],
			}),
		).toEqual({ "b:enabled": true });
	});

	test("empty failedKeys clears like success but stays a failure result", () => {
		expect(
			pendingAfterCommit(PENDING, { error: "late", failedKeys: [] }),
		).toEqual({});
	});
});
