import { describe, expect, test } from "bun:test";
import {
	ACTIVITY_SEARCH_DEFAULTS,
	ACTIVITY_VERDICTS,
	ANALYTICS_METRICS,
	ANALYTICS_SEARCH_DEFAULTS,
	activitySearchSchema,
	analyticsSearchSchema,
	RESPONSE_SCOPES,
	RESPONSES_SEARCH_DEFAULTS,
	responsesSearchSchema,
} from "./repo-search";

describe("activitySearchSchema", () => {
	test("defaults to all verdicts", () => {
		expect(activitySearchSchema.parse({})).toEqual(ACTIVITY_SEARCH_DEFAULTS);
	});

	test("falls back on a bad verdict", () => {
		expect(activitySearchSchema.parse({ verdict: "maybe" })).toEqual({
			verdict: "all",
		});
		expect(activitySearchSchema.parse({ verdict: 3 })).toEqual({
			verdict: "all",
		});
	});

	test("round trips every verdict", () => {
		for (const verdict of ACTIVITY_VERDICTS) {
			expect(activitySearchSchema.parse({ verdict })).toEqual({ verdict });
		}
	});
});

describe("analyticsSearchSchema", () => {
	test("defaults to the review metric", () => {
		expect(analyticsSearchSchema.parse({})).toEqual(ANALYTICS_SEARCH_DEFAULTS);
	});

	test("falls back on a bad metric", () => {
		expect(analyticsSearchSchema.parse({ metric: "pending" })).toEqual({
			metric: "review",
		});
	});

	test("round trips every metric", () => {
		for (const metric of ANALYTICS_METRICS) {
			expect(analyticsSearchSchema.parse({ metric })).toEqual({ metric });
		}
	});
});

describe("responsesSearchSchema", () => {
	test("defaults to the blocked scope", () => {
		expect(responsesSearchSchema.parse({})).toEqual(RESPONSES_SEARCH_DEFAULTS);
	});

	test("falls back on a bad scope", () => {
		expect(responsesSearchSchema.parse({ scope: ["pass"] })).toEqual({
			scope: "block",
		});
	});

	test("round trips every scope", () => {
		for (const scope of RESPONSE_SCOPES) {
			expect(responsesSearchSchema.parse({ scope })).toEqual({ scope });
		}
	});

	test("keeps unrelated keys out", () => {
		expect(responsesSearchSchema.parse({ scope: "pass", q: "x" })).toEqual({
			scope: "pass",
		});
	});
});
