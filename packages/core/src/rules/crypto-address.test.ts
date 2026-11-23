import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	cryptoAddress,
	cryptoAddressV2,
	cryptoAddressV3,
} from "./crypto-address.ts";
import { evaluateRule } from "./define.ts";
import { fixtureContext, fixtureDiff, fixtureEvent } from "./test-context.ts";

const INCIDENT_ADDRESS = "S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH";
const incidentFile: {
	filename: string;
	status: "modified";
	additions: number;
	deletions: number;
	patch: string;
} = await Bun.file(
	fileURLToPath(
		new URL(
			"../../../forge-github/fixtures/crypto-address-col-97-bun-lock.json",
			import.meta.url,
		),
	),
).json();

describe("crypto-address@3", () => {
	test("reproduces the customer's false block at @2 and clears it at @3", async () => {
		const ctx = await fixtureContext({
			diff: [{ ...incidentFile, path: incidentFile.filename }],
		});
		const before = await evaluateRule(cryptoAddressV2, ctx, {});
		expect(before.passed).toBe(false);
		expect(before.evidence).toEqual({
			matches: [{ kind: "sol", value: INCIDENT_ADDRESS, location: "bun.lock" }],
		});
		const after = await evaluateRule(cryptoAddressV3, ctx, {});
		expect(after.passed).toBe(true);
		expect(after.evidence).toEqual({ matches: [], checks: [] });
	});

	test("also ignores the customer's integrity hash when it is added", async () => {
		const line = incidentFile.patch
			.split("\n")
			.find((text) => text.includes(INCIDENT_ADDRESS));
		expect(line?.startsWith(" ")).toBe(true);
		const ctx = await fixtureContext({
			diff: fixtureDiff([
				{ path: "bun.lock", patch: `@@ -0,0 +1 @@\n+${line?.slice(1)}` },
			]),
		});
		expect((await evaluateRule(cryptoAddressV3, ctx, {})).passed).toBe(true);
	});

	test("does not exempt lockfiles and records the added file line", async () => {
		const ctx = await fixtureContext({
			diff: fixtureDiff([
				{
					path: "bun.lock",
					patch:
						"@@ -10,2 +10,3 @@\n context\n+donate: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\n context",
				},
			]),
		});
		const result = await evaluateRule(cryptoAddressV3, ctx, {});
		expect(result.passed).toBe(false);
		expect(result.evidence).toMatchObject({
			matches: [
				{
					kind: "btc",
					location: "bun.lock",
					line: 11,
					confirmation: "checksum",
				},
			],
		});
	});

	test("ignores removed addresses, context and file headers", async () => {
		const ctx = await fixtureContext({
			diff: fixtureDiff([
				{
					path: "old.txt",
					patch: `--- a/${INCIDENT_ADDRESS}\n+++ b/${INCIDENT_ADDRESS}\n@@ -1,2 +1 @@\n-wallet: ${INCIDENT_ADDRESS}\n wallet: ${INCIDENT_ADDRESS}`,
				},
			]),
		});
		expect((await evaluateRule(cryptoAddressV3, ctx, {})).passed).toBe(true);
	});

	test("does not treat absence of activity as an invalid wallet in payment context", async () => {
		const ctx = await fixtureContext({
			diff: fixtureDiff([{ patch: `+wallet: ${INCIDENT_ADDRESS}` }]),
			readCryptoAddressActivity: async (kind, value) => ({
				kind,
				value,
				network: "solana-mainnet",
				checkedAt: "2026-11-20T21:00:00.000Z",
				status: "not-observed",
			}),
		});
		expect(
			(await evaluateRule(cryptoAddressV3, ctx, {})).evidence,
		).toMatchObject({
			matches: [{ confirmation: "payment-context" }],
			checks: [{ status: "not-observed" }],
		});
	});

	test("ambiguous Solana strings use chain evidence and remain deterministic", async () => {
		for (const status of ["observed", "not-observed", "unavailable"] as const) {
			const ctx = await fixtureContext({
				diff: fixtureDiff([{ patch: `+${INCIDENT_ADDRESS}` }]),
				readCryptoAddressActivity: async (kind, value) => ({
					kind,
					value,
					network: "solana-mainnet",
					checkedAt: "2026-11-20T21:00:00.000Z",
					status,
				}),
			});
			const result = await evaluateRule(cryptoAddressV3, ctx, {});
			expect(result.status).toBe(
				status === "unavailable" ? "skipped" : "evaluated",
			);
			expect(result.passed).toBe(status === "not-observed");
			expect(await evaluateRule(cryptoAddressV3, ctx, {})).toEqual(result);
		}
	});

	test("missing activity and missing patches cannot establish a clean scan", async () => {
		for (const diff of [
			null,
			fixtureDiff([{ patchUnavailable: "omitted" }]),
			fixtureDiff([{ patch: `+${INCIDENT_ADDRESS}` }]),
		]) {
			expect(
				(
					await evaluateRule(
						cryptoAddressV3,
						await fixtureContext({ diff }),
						{},
					)
				).status,
			).toBe("skipped");
		}
	});
});

describe("crypto-address@1", () => {
	test("stored @1 retains its clean result for an omitted patch", async () => {
		const ctx = await fixtureContext({
			diff: [
				{
					path: "omitted.txt",
					status: null,
					additions: null,
					deletions: null,
					patchUnavailable: "omitted",
				},
			],
		});
		const result = await evaluateRule(cryptoAddress, ctx, {});
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(true);
	});
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
			const result = await evaluateRule(cryptoAddressV2, ctx, {});
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
