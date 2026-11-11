import { expect, test } from "bun:test";
import { contributorAllowlist } from "./contributor-allowlist.ts";
import { evaluateRule } from "./define.ts";
import { fixtureContext } from "./test-context.ts";

test.each([
	true,
	false,
])("allowlist uses the worker's verified identity lookup (%s)", async (authorAllowlisted) => {
	const result = await evaluateRule(
		contributorAllowlist,
		{ ...(await fixtureContext()), authorAllowlisted },
		{},
	);
	expect(result).toMatchObject({
		status: "evaluated",
		passed: authorAllowlisted,
		evidence: { allowlisted: authorAllowlisted },
	});
});

test.each([
	null,
	undefined,
])("unavailable allowlist status (%s) skips", async (authorAllowlisted) => {
	const result = await evaluateRule(
		contributorAllowlist,
		{ ...(await fixtureContext()), authorAllowlisted },
		{},
	);
	expect(result.status).toBe("skipped");
	expect(result.passed).toBe(false);
});
