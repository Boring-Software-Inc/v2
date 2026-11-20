import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { WalletChain, WalletNetwork } from "@tripwire/contracts";
import {
	validateWalletAddress,
	WALLET_ADDRESS_CHAINS,
} from "./wallet-address.ts";

const vectors: {
	id: string;
	chain: WalletChain;
	network: WalletNetwork;
	address: string;
	expectedValid: boolean;
	source: string;
}[] = await Bun.file(
	fileURLToPath(
		new URL("../fixtures/wallet-address-vectors.json", import.meta.url),
	),
).json();
const overrides: {
	id: string;
	expectedValid: boolean;
	finding: string;
	source: string;
}[] = await Bun.file(
	fileURLToPath(
		new URL(
			"../fixtures/wallet-address-protocol-overrides.json",
			import.meta.url,
		),
	),
).json();

describe("wallet address conformance", () => {
	test("unknown option names cannot silently select the wrong network", () => {
		const address = "0x52908400098527886E0F7030069857D2E4169EE7";
		for (const options of [
			{ chain: "evm", networkType: "testnet" },
			{ chain: "evm", chainId: 8453 },
			{ chain: "evm", networks: ["testnet"] },
		])
			expect(validateWalletAddress(address, options)).toEqual({
				status: "invalid",
				reason: "invalid-input",
			});
	});
	test("Node and Bun agree on the entire captured conformance corpus", () => {
		const actual: unknown = JSON.parse(
			execFileSync(
				"node",
				[
					fileURLToPath(
						new URL(
							"../fixtures/wallet-address-node-check.mjs",
							import.meta.url,
						),
					),
				],
				{ encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
			),
		);
		expect(actual).toEqual(
			vectors.map((vector) =>
				validateWalletAddress(vector.address, {
					chain: vector.chain,
					network: vector.network,
				}),
			),
		);
	});
	for (const vector of vectors)
		test(`${vector.id}: ${vector.chain}/${vector.network}`, () => {
			const result = validateWalletAddress(vector.address, {
				chain: vector.chain,
				network: vector.network,
			});
			expect(result.status === "valid").toBe(
				overrides.find((item) => item.id === vector.id)?.expectedValid ??
					vector.expectedValid,
			);
			if (result.status === "valid") {
				expect(
					validateWalletAddress(result.canonicalAddress, {
						chain: vector.chain,
						network: vector.network,
					}),
				).toEqual(result);
			}
		});
	test("mutating returned networks cannot alter subsequent validations", () => {
		const address = "0x0000000000000000000000000000000000000001";
		const first = validateWalletAddress(address, { chain: "evm" });
		expect(first.status).toBe("valid");
		if (first.status !== "valid") return;
		first.compatibleNetworks.splice(0);
		expect(validateWalletAddress(address, { chain: "evm" }).status).toBe(
			"valid",
		);
	});
	test("every confirmed chain family has independent conformance vectors", () => {
		expect([...new Set(vectors.map((vector) => vector.chain))].sort()).toEqual(
			WALLET_ADDRESS_CHAINS.map((entry) => entry.chain).sort(),
		);
	});
	test("malformed, unsupported and oversized input never throws", () => {
		for (const value of [
			null,
			undefined,
			false,
			123,
			{},
			[],
			"",
			" ",
			"\u200b",
			"a".repeat(513),
		]) {
			expect(validateWalletAddress(value, { chain: "bitcoin" }).status).toBe(
				"invalid",
			);
		}
		expect(validateWalletAddress("address", { chain: "toString" })).toEqual({
			status: "unsupported",
			reason: "chain",
		});
		expect(
			validateWalletAddress("address", { chain: "bitcoin", network: "devnet" }),
		).toEqual({ status: "unsupported", reason: "network" });
		expect(validateWalletAddress("address", null)).toEqual({
			status: "invalid",
			reason: "invalid-input",
		});
	});
});
