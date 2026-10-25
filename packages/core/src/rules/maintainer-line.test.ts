import { describe, expect, test } from "bun:test";
import { maintainerLine } from "./maintainer-line.ts";

describe("maintainerLine", () => {
	test.each([
		["account-age@1", { accountAgeDays: 1, minDays: 7 }, "Account 1 day old"],
		["account-age@1", { accountAgeDays: 4, minDays: 7 }, "Account 4 days old"],
		[
			"crypto-address@1",
			{ matches: [{ kind: "eth", value: "0x", location: "title" }] },
			"1 wallet address",
		],
		[
			"crypto-address@1",
			{
				matches: [
					{ kind: "eth", value: "0x", location: "title" },
					{ kind: "btc", value: "bc1", location: "README.md" },
				],
			},
			"2 wallet addresses",
		],
		[
			"english-only@1",
			{ ratio: 0.724, lettersExamined: 20, sample: "x" },
			"Title 72% non-latin",
		],
		[
			"honeypot@1",
			{ touched: [".github/workflows/ci.yml"] },
			"Touches .github/workflows/ci.yml",
		],
		["honeypot@1", { touched: ["a", "b"] }, "Touches 2 protected files"],
		["max-files-changed@1", { filesChanged: 1, max: 200 }, "1 file changed"],
		[
			"max-files-changed@1",
			{ filesChanged: 723, max: 200 },
			"723 files changed",
		],
		["min-merged-prs@1", { mergedInRepo: 1, min: 2 }, "1 merge here"],
		[
			"min-merged-prs@2",
			{ mergedElsewhere: 0, mergedInRepo: 0, min: 1, trustedAfter: 1 },
			"0 merges elsewhere",
		],
		[
			"pr-rate-limit@1",
			{ count: 6, maxPerWindow: 5, windowHours: 1, intervalCov: null },
			"6 change requests in 1 hour",
		],
		[
			"profile-readme@1",
			{ hasProfileText: false, length: 0, minLength: 32 },
			"No profile README",
		],
		[
			"profile-readme@1",
			{ hasProfileText: true, length: 1, minLength: 32 },
			"Profile README 1 character",
		],
	])("%s %j", (ref, evidence, line) => {
		expect(maintainerLine(ref, evidence)).toBe(line);
	});

	test("unknown rules and evidence that does not parse give no line", () => {
		expect(maintainerLine("custom-x@1", {})).toBeNull();
		expect(maintainerLine("account-age@1", { wrong: true })).toBeNull();
		expect(maintainerLine("ai-review@2", {})).toBeNull();
	});
});
