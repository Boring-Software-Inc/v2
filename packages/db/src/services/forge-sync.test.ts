import { describe, expect, test } from "bun:test";
import { LABEL_SYNC_STALE_MS, labelsNeedSync } from "./labels.ts";
import { SUGGESTION_SYNC_STALE_MS, suggestionsNeedSync } from "./repos.ts";
import { REVIEWER_SYNC_STALE_MS, reviewersNeedSync } from "./reviewers.ts";

const now = new Date("2026-10-23T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("reviewersNeedSync", () => {
	test("a repo that never synced needs a sync", () => {
		expect(reviewersNeedSync(null, now)).toBe(true);
	});

	test("a fresh sync does not", () => {
		expect(reviewersNeedSync(ago(60_000), now)).toBe(false);
	});

	test("a sync a day old does", () => {
		expect(reviewersNeedSync(ago(REVIEWER_SYNC_STALE_MS), now)).toBe(true);
	});
});

describe("labelsNeedSync", () => {
	test("a repo that never synced needs a sync", () => {
		expect(labelsNeedSync(null, now)).toBe(true);
	});

	test("a label made on the forge a minute ago is picked up", () => {
		expect(labelsNeedSync(ago(LABEL_SYNC_STALE_MS), now)).toBe(true);
	});

	test("a sync seconds old is reused", () => {
		expect(labelsNeedSync(ago(5_000), now)).toBe(false);
	});
});

describe("suggestionsNeedSync", () => {
	test("a repo with no cached branches needs a sync", () => {
		expect(suggestionsNeedSync(null, now)).toBe(true);
	});

	test("a branch pushed a minute ago is picked up", () => {
		expect(suggestionsNeedSync(ago(SUGGESTION_SYNC_STALE_MS), now)).toBe(true);
	});

	test("a sync seconds old is reused", () => {
		expect(suggestionsNeedSync(ago(5_000), now)).toBe(false);
	});
});
