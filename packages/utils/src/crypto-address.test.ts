import { describe, expect, test } from "bun:test";
import { cryptoAddressCandidates, isCryptoAddress } from "./crypto-address.ts";

describe("address encodings", () => {
	test("verifies the mixed-case EIP-55 reference vectors", async () => {
		for (const address of [
			"0x52908400098527886E0F7030069857D2E4169EE7",
			"0x8617E340B3D01FA5F11F306F4090FD50E238070D",
			"0xde709f2102306220921060314715629080e2fb77",
			"0x27b1fdb04752bbc536007a920d24acb045561c26",
			"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
			"0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
			"0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
			"0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
		])
			expect(await isCryptoAddress("eth", address)).toBe(true);
		expect(
			await isCryptoAddress(
				"eth",
				"0x5Aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
			),
		).toBe(false);
	});

	test("verifies Bitcoin Base58Check, Bech32 and Bech32m", async () => {
		for (const address of [
			"1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
			"3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
			"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
			"bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
			"BC1SW50QGDZ25J",
		])
			expect(await isCryptoAddress("btc", address)).toBe(true);
		for (const address of [
			"1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb",
			"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5",
			"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
			"bc1Qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
			"BC1SW50QA3JX3S",
		])
			expect(await isCryptoAddress("btc", address)).toBe(false);
	});

	test("Solana requires 32 decoded bytes, including leading zeros", async () => {
		expect(
			await isCryptoAddress(
				"sol",
				"S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH",
			),
		).toBe(true);
		expect(
			await isCryptoAddress("sol", "11111111111111111111111111111111"),
		).toBe(true);
		expect(await isCryptoAddress("sol", "z".repeat(44))).toBe(false);
		expect(await isCryptoAddress("sol", "1".repeat(33))).toBe(false);
		expect(await isCryptoAddress("sol", "0".repeat(32))).toBe(false);
	});

	test("does not split integrity hashes or longer tokens into addresses", () => {
		const address = "S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH";
		expect(
			cryptoAddressCandidates(
				`sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/${address}+g==`,
			),
		).toEqual([]);
		expect(
			cryptoAddressCandidates(`prefix${address}suffix ${address}+g==`),
		).toEqual([]);
		expect(
			cryptoAddressCandidates(`https://explorer.solana.com/address/${address}`),
		).toContainEqual({ kind: "sol", value: address, index: 36 });
		expect(
			cryptoAddressCandidates(`sha512-${address} wallet: ${address}`),
		).toHaveLength(2);
	});
});
