import { describe, expect, test } from "bun:test";
import {
	cryptoHexCodeSchema,
	cryptoHexQuantitySchema,
	solanaLamportsSchema,
} from "./crypto-address.ts";
import {
	walletAddressObservationSchema,
	walletAddressValidationSchema,
} from "./wallet-address.ts";

const base = {
	chain: "evm",
	chainId: 1,
	network: "mainnet",
	address: "0x52908400098527886E0F7030069857D2E4169EE7",
	checkedAt: "2026-11-20T12:00:00.000Z",
	status: "not-observed",
};

describe("wallet evidence boundaries", () => {
	test("native balances and nonces are exact unsigned decimal units", () => {
		for (const value of ["0", "1", "18446744073709551615", "9".repeat(78)])
			expect(
				walletAddressObservationSchema.safeParse({
					...base,
					status: "observed",
					balance: value,
					nonce: value,
				}).success,
			).toBe(true);
		for (const value of ["-1", "1.5", "1e18", "00", "NaN", "9".repeat(101)])
			expect(
				walletAddressObservationSchema.safeParse({ ...base, balance: value })
					.success,
			).toBe(false);
	});
	test("negative observations reject contradictory positive evidence", () => {
		for (const extra of [
			{ balance: "1" },
			{ nonce: "1" },
			{ transactionCount: 1 },
			{ codePresent: true },
			{ accountOwner: "program" },
			{ executable: false },
		])
			expect(
				walletAddressObservationSchema.safeParse({ ...base, ...extra }).success,
			).toBe(false);
		expect(
			walletAddressObservationSchema.safeParse({
				...base,
				balance: "0",
				nonce: "0",
				transactionCount: 0,
				codePresent: false,
			}).success,
		).toBe(true);
	});
	test("EVM evidence cannot omit its ledger or attach that ID to another family", () => {
		expect(
			walletAddressObservationSchema.safeParse({ ...base, chainId: undefined })
				.success,
		).toBe(false);
		expect(
			walletAddressObservationSchema.safeParse({ ...base, chain: "solana" })
				.success,
		).toBe(false);
	});
	test("validation metadata must agree about the selected network", () => {
		const value = {
			status: "valid",
			chain: "evm",
			chainId: 1,
			network: "mainnet",
			canonicalAddress: base.address,
			format: "evm-20-byte",
			compatibleNetworks: ["mainnet", "testnet"],
			networkDiscrimination: "shared",
		};
		expect(walletAddressValidationSchema.safeParse(value).success).toBe(true);
		for (const extra of [
			{ compatibleNetworks: ["testnet"] },
			{ chainId: undefined },
			{ networkDiscrimination: "encoded" },
		])
			expect(
				walletAddressValidationSchema.safeParse({ ...value, ...extra }).success,
			).toBe(false);
	});
	test("RPC hex quantities reject leading zeros, nonhex digits and empty data", () => {
		for (const value of ["0x0", "0x1", "0xff", "0xABCDEF"])
			expect(cryptoHexQuantitySchema.safeParse(value).success).toBe(true);
		for (const value of ["0x", "0x00", "0x01", "0xg", "0X1", "1"])
			expect(cryptoHexQuantitySchema.safeParse(value).success).toBe(false);
		expect(cryptoHexCodeSchema.safeParse("0x").success).toBe(true);
		expect(cryptoHexCodeSchema.safeParse("0x0").success).toBe(false);
	});
	test("Solana unsigned 64-bit units preserve full range and reject overflow", () => {
		for (const value of [
			0,
			1,
			Number.MAX_SAFE_INTEGER,
			"9007199254740993",
			"18446744073709551615",
		])
			expect(solanaLamportsSchema.safeParse(value).success).toBe(true);
		for (const value of [
			-1,
			1.5,
			Number.MAX_SAFE_INTEGER + 1,
			"-1",
			"01",
			"18446744073709551616",
			"1.5",
			"NaN",
			"1e30",
			"",
		])
			expect(solanaLamportsSchema.safeParse(value).success).toBe(false);
	});
});
