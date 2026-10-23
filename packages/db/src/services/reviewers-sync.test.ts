import { describe, expect, test } from "bun:test";
import { REVIEWER_SYNC_STALE_MS, reviewersNeedSync } from "./reviewers.ts";

const now = new Date("2026-10-23T12:00:00Z");

describe("reviewersNeedSync", () => {
	test("a repo that never synced needs a sync", () => {
		expect(reviewersNeedSync(null, now)).toBe(true);
	});

	test("a fresh sync does not", () => {
		expect(reviewersNeedSync(new Date(now.getTime() - 60_000), now)).toBe(
			false,
		);
	});

	test("a sync a day old does", () => {
		expect(
			reviewersNeedSync(new Date(now.getTime() - REVIEWER_SYNC_STALE_MS), now),
		).toBe(true);
	});
});
