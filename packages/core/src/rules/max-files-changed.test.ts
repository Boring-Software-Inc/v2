import { describe, expect, test } from "bun:test";
import { evaluateRule } from "./define.ts";
import { maxFilesChanged } from "./max-files-changed.ts";
import { fixtureContext, fixtureDiff } from "./test-context.ts";

describe("max-files-changed@1", () => {
	test("complete filenames remain usable when per-file metadata is unavailable", async () => {
		const ctx = await fixtureContext({
			diff: fixtureDiff([
				{
					status: null,
					additions: null,
					deletions: null,
					patchUnavailable: "unavailable",
				},
				{
					status: null,
					additions: null,
					deletions: null,
					patchUnavailable: "unavailable",
				},
			]),
		});
		const result = await evaluateRule(maxFilesChanged, ctx, { max: 1 });
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(false);
		expect(result.evidence).toEqual({ filesChanged: 2, max: 1 });
	});
	test("passes a small diff", async () => {
		const ctx = await fixtureContext({ diff: fixtureDiff([{}, {}]) });
		const result = await evaluateRule(maxFilesChanged, ctx, { max: 10 });
		expect(result.passed).toBe(true);
		expect(result.evidence).toEqual({ filesChanged: 2, max: 10 });
	});

	test("blocks the 4000-files vendored-code special", async () => {
		const files = Array.from({ length: 50 }, (_, i) => ({
			path: `vendor/dep-${i}.js`,
		}));
		const ctx = await fixtureContext({ diff: fixtureDiff(files) });
		const result = await evaluateRule(maxFilesChanged, ctx, { max: 20 });
		expect(result.passed).toBe(false);
		expect(result.evidence).toMatchObject({ filesChanged: 50 });
	});

	test("skips when the diff read was unavailable", async () => {
		const result = await evaluateRule(
			maxFilesChanged,
			await fixtureContext({ diff: null }),
			{ max: 10 },
		);
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("could not read the files");
	});
});
