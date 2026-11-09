import { expect, test } from "bun:test";
import { evaluateRule } from "./define.ts";
import { sharedSpamBlocklist } from "./shared-spam-blocklist.ts";
import { fixtureContext } from "./test-context.ts";

test("records the same evidence for a verified author and skips another identity", async () => {
	const ctx = await fixtureContext();
	const match = {
		accountId: ctx.event.actor.externalId,
		reason: "Fixture for review routing",
		revision: 3,
	};
	const result = await evaluateRule(sharedSpamBlocklist, ctx, match);
	expect(result).toMatchObject({
		status: "evaluated",
		passed: false,
		evidence: match,
	});
	expect(await evaluateRule(sharedSpamBlocklist, ctx, match)).toEqual(result);
	expect(
		await evaluateRule(sharedSpamBlocklist, ctx, { ...match, accountId: "1" }),
	).toMatchObject({ status: "skipped" });
});
