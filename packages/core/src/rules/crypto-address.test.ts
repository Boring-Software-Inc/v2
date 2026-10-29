import { describe, expect, test } from "bun:test";
import { cryptoAddress } from "./crypto-address.ts";
import { evaluateRule } from "./define.ts";
import { fixtureContext, fixtureDiff, fixtureEvent } from "./test-context.ts";

describe("crypto-address@1", () => {
	for (const positive of [true, false]) {
		test(`an omitted patch ${positive ? "preserves a known match" : "cannot establish a clean scan"}`, async () => {
			const ctx = await fixtureContext({
				diff: [
					{
						path: "hidden.txt",
						status: null,
						additions: null,
						deletions: null,
						patchUnavailable: "omitted",
					},
					{
						path: "visible.txt",
						status: "added",
						additions: 1,
						deletions: 0,
						patch: positive
							? "+0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"
							: "+ordinary text",
					},
				],
			});
			const result = await evaluateRule(cryptoAddress, ctx, {});
			expect(result.status).toBe(positive ? "evaluated" : "skipped");
			expect(result.passed).toBe(false);
		});
	}
	test("passes a clean change request", async () => {
		const result = await evaluateRule(
			cryptoAddress,
			await fixtureContext(),
			{},
		);
		expect(result.passed).toBe(true);
		expect(result.evidence).toEqual({ matches: [] });
	});

	test("blocks an eth address in a comment", async () => {
		const event = await fixtureEvent("comment.created.event");
		if (event.kind !== "comment.created") {
			throw new Error("wrong fixture");
		}
		const ctx = await fixtureContext({
			event: {
				...event,
				comment: {
					...event.comment,
					body: "send gas to 0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B thanks",
				},
			},
		});
		const result = await evaluateRule(cryptoAddress, ctx, {});
		expect(result.passed).toBe(false);
		const evidence = result.evidence as {
			matches: { kind: string; location: string }[];
		};
		expect(evidence.matches[0]).toMatchObject({
			kind: "eth",
			location: "comment",
		});
	});

	test("blocks a btc address hidden in a diff patch", async () => {
		const ctx = await fixtureContext({
			diff: fixtureDiff([
				{
					path: "README.md",
					patch: "+ donate: bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
				},
			]),
		});
		const result = await evaluateRule(cryptoAddress, ctx, {});
		expect(result.passed).toBe(false);
		const evidence = result.evidence as { matches: { location: string }[] };
		expect(evidence.matches[0]?.location).toBe("README.md");
	});
});
