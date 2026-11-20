import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha2.js";
import {
	base32nopad,
	base58,
	base58xrp,
	base64urlnopad,
	bech32,
	bech32m,
	createBase58check,
} from "@scure/base";
import type { WalletChain, WalletNetwork } from "@tripwire/contracts";
import { encode as encodeCbor, Tagged } from "cborg";
import { cryptoAddressCandidates } from "./crypto-address.ts";
import {
	validateWalletAddress,
	WALLET_ADDRESS_CHAINS,
} from "./wallet-address.ts";

const vectors: {
	id: string;
	chain: WalletChain;
	network: WalletNetwork;
	address: string;
}[] = await Bun.file(
	fileURLToPath(
		new URL("../fixtures/wallet-address-vectors.json", import.meta.url),
	),
).json();
const valid = vectors.filter(
	(item) =>
		validateWalletAddress(item.address, {
			chain: item.chain,
			network: item.network,
		}).status === "valid",
);
function sample(chain: WalletChain): string {
	const item = valid.find(
		(entry) => entry.chain === chain && entry.network === "mainnet",
	);
	if (!item) throw new Error(`Missing sample ${chain}`);
	return item.address;
}
function crc16(bytes: Uint8Array): number {
	let crc = 0;
	for (const byte of bytes) {
		crc ^= byte << 8;
		for (let i = 0; i < 8; i++)
			crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 65535;
	}
	return crc;
}
function stellar(version: number, payload: Uint8Array): string {
	const body = Uint8Array.from([version, ...payload]);
	const checksum = crc16(body);
	return base32nopad.encode(
		Uint8Array.from([...body, checksum & 255, checksum >>> 8]),
	);
}
function xAddress(body: Uint8Array): string {
	return base58xrp.encode(
		Uint8Array.from([...body, ...sha256(sha256(body)).slice(0, 4)]),
	);
}

describe("wallet address network and mutation matrix", () => {
	for (const vector of valid)
		test(`${vector.id}: network discrimination and checksum mutation`, () => {
			const result = validateWalletAddress(vector.address, {
				chain: vector.chain,
				network: vector.network,
			});
			if (result.status !== "valid")
				throw new Error("Conformance input must be valid");
			for (const network of WALLET_ADDRESS_CHAINS.find(
				(entry) => entry.chain === vector.chain,
			)?.networks ?? []) {
				expect(
					validateWalletAddress(vector.address, {
						chain: vector.chain,
						network,
					}).status === "valid",
				).toBe(result.compatibleNetworks.includes(network));
			}
			if (
				vector.chain === "solana" ||
				vector.chain === "evm" ||
				vector.chain === "sui" ||
				result.format === "ton-raw"
			)
				return;
			const uppercase = vector.address === vector.address.toUpperCase();
			const last = vector.address.at(-1);
			const replacement = uppercase
				? last === "P"
					? "Q"
					: "P"
				: last === "p"
					? "q"
					: "p";
			const mutated = vector.address.slice(0, -1) + replacement;
			expect(
				validateWalletAddress(mutated, {
					chain: vector.chain,
					network: vector.network,
				}).status,
			).toBe("invalid");
		});

	for (const { chain } of WALLET_ADDRESS_CHAINS)
		test(`${chain}: whitespace, Unicode, null bytes and URI confusion`, () => {
			const address = sample(chain);
			for (const input of [
				` ${address}`,
				`${address} `,
				`${address}\n`,
				`${address}\0`,
				`\ufeff${address}`,
				`\u200b${address}`,
				`${address}\u200b`,
				`https://example.com/${address}`,
				`${chain}:${address}?amount=1`,
			])
				expect(validateWalletAddress(input, { chain }).status).toBe("invalid");
		});

	for (const { chain } of WALLET_ADDRESS_CHAINS)
		test(`${chain}: deterministic seeded malformed-input sweep`, () => {
			let state = 0x12345678;
			for (let iteration = 0; iteration < 200; iteration++) {
				state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
				const length = state % 160;
				const input = Array.from({ length }, () => {
					state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
					return String.fromCharCode(32 + (state % 95));
				}).join("");
				const first = validateWalletAddress(input, { chain });
				expect(validateWalletAddress(input, { chain })).toEqual(first);
				if (first.status === "valid")
					expect(
						validateWalletAddress(first.canonicalAddress, { chain }),
					).toEqual(first);
			}
		});
});

describe("protocol edge cases", () => {
	test("TRON hex and Base58Check are canonical equivalents", () => {
		const address = sample("tron");
		const bytes = createBase58check(sha256).decode(address);
		const hexadecimal = [...bytes]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		for (const input of [
			hexadecimal,
			`0x${hexadecimal}`,
			hexadecimal.toUpperCase(),
		])
			expect(validateWalletAddress(input, { chain: "tron" })).toEqual(
				validateWalletAddress(address, { chain: "tron" }),
			);
	});
	test("generic Substrate prefix 42 does not prove a testnet", () => {
		const address = vectors.find(
			(item) => item.chain === "polkadot" && item.network === "testnet",
		)?.address;
		if (!address) throw new Error("Missing generic SS58 source");
		for (const network of ["mainnet", "testnet"])
			expect(
				validateWalletAddress(address, { chain: "polkadot", network }),
			).toMatchObject({ status: "valid", networkDiscrimination: "shared" });
	});
	test("EVM aliases and canonical EIP-55 checksums compose without inferring chain activity", () => {
		for (const chain of [
			"ETH",
			"ethereum",
			"evm",
			"base",
			"arbitrum",
			"polygon",
			"bnb",
			"optimism",
			"avalanche-c",
		]) {
			const result = validateWalletAddress(sample("evm").toLowerCase(), {
				chain,
			});
			expect(result).toMatchObject({
				status: "valid",
				chain: "evm",
				networkDiscrimination: "shared",
			});
		}
	});
	test("SegWit checks the witness version, checksum variant, length and padding", () => {
		const twenty = bech32.toWords(new Uint8Array(20));
		const thirtyTwo = bech32.toWords(new Uint8Array(32));
		for (const address of [
			bech32m.encode("bc", [0, ...twenty]),
			bech32.encode("bc", [1, ...thirtyTwo]),
			bech32m.encode("bc", [17, ...twenty]),
			bech32.encode("bc", [0, ...bech32.toWords(new Uint8Array(21))]),
			bech32m.encode("bc", [1, ...bech32.toWords(new Uint8Array(1))]),
			bech32m.encode("bc", [1, ...bech32.toWords(new Uint8Array(41))]),
		])
			expect(validateWalletAddress(address, { chain: "bitcoin" }).status).toBe(
				"invalid",
			);
		const nonzeroPadding = [...twenty];
		nonzeroPadding[nonzeroPadding.length - 1] = 1;
		expect(
			validateWalletAddress(bech32.encode("bc", [0, ...nonzeroPadding]), {
				chain: "bitcoin",
			}).status,
		).toBe("valid");
		const padded = bech32.toWords(new Uint8Array(32));
		padded[padded.length - 1] = 1;
		expect(
			validateWalletAddress(bech32m.encode("bc", [1, ...padded]), {
				chain: "bitcoin",
			}).status,
		).toBe("invalid");
		const regtest = bech32m.encode("bcrt", [1, ...thirtyTwo]);
		expect(
			validateWalletAddress(regtest, { chain: "bitcoin", network: "regtest" })
				.status,
		).toBe("valid");
		expect(
			validateWalletAddress(regtest, { chain: "bitcoin", network: "mainnet" })
				.status,
		).toBe("invalid");
	});
	test("wrong-chain Base58 versions cannot pass merely because their checksum is valid", () => {
		const encode = createBase58check(sha256);
		for (const version of [1, 38, 60, 113, 255])
			expect(
				validateWalletAddress(
					encode.encode(Uint8Array.from([version, ...new Uint8Array(20)])),
					{ chain: "bitcoin", network: "testnet" },
				).status,
			).toBe("invalid");
		const p2sh = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
		for (const chain of ["bitcoin", "litecoin", "bitcoin-cash"])
			expect(validateWalletAddress(p2sh, { chain }).status).toBe("valid");
	});
	test("Solana accepts unfunded keys, leading-zero keys and program-derived addresses without pretending to verify ownership", () => {
		for (const address of [
			"11111111111111111111111111111111",
			"S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH",
			"Vote111111111111111111111111111111111111111",
		])
			for (const network of ["mainnet", "testnet", "devnet"])
				expect(
					validateWalletAddress(address, { chain: "solana", network }).status,
				).toBe("valid");
		for (const address of [
			"1".repeat(31),
			"1".repeat(33),
			"z".repeat(44),
			"0".repeat(32),
		])
			expect(validateWalletAddress(address, { chain: "solana" }).status).toBe(
				"invalid",
			);
	});
	test("XRP X-address flags, reserved bytes and embedded network are validated after checksum verification", () => {
		const source = valid.find(
			(entry) => entry.chain === "xrp" && entry.address.startsWith("X"),
		);
		if (!source) throw new Error("Missing XRPL X-address capture");
		const body = base58xrp.decode(source.address).slice(0, -4);
		for (const [index, byte] of [
			[22, 2],
			[27, 1],
			[30, 1],
			[0, 9],
		]) {
			const changed = body.slice();
			changed[index ?? 0] = byte ?? 0;
			expect(
				validateWalletAddress(xAddress(changed), { chain: "xrp" }).status,
			).toBe("invalid");
		}
		expect(
			validateWalletAddress(source.address, {
				chain: "xrp",
				network: "testnet",
			}),
		).toMatchObject({ status: "invalid", reason: "network-mismatch" });
	});
	test("Cardano validates payload anatomy and network header, not just a Bech32 checksum", () => {
		const main = valid.find(
			(entry) =>
				entry.chain === "cardano" && entry.address.startsWith("addr1q"),
		);
		if (!main) throw new Error("Missing Cardano base capture");
		const decoded = bech32.decode(main.address, 200);
		const bytes = bech32.fromWords(decoded.words);
		for (const bad of [
			bech32.encode("addr_test", decoded.words, 200),
			bech32.encode("stake", decoded.words, 200),
			bech32.encode("addr", bech32.toWords(bytes.slice(0, -1)), 200),
		])
			expect(validateWalletAddress(bad, { chain: "cardano" }).status).toBe(
				"invalid",
			);
		const altered = bytes.slice();
		altered[0] = 0x91;
		expect(
			validateWalletAddress(
				bech32.encode("addr", bech32.toWords(altered), 200),
				{ chain: "cardano" },
			).status,
		).toBe("invalid");
		for (const bad of [
			base58.encode(encodeCbor([new Tagged(24, new Uint8Array(2)), 0])),
			base58.encode(encodeCbor([new Tagged(25, new Uint8Array(2)), 0])),
			base58.encode(encodeCbor([new Uint8Array(2), 0])),
		])
			expect(validateWalletAddress(bad, { chain: "cardano" }).status).toBe(
				"invalid",
			);
	});
	test("Stellar accepts muxed and contract addresses, rejects secret seeds and public-key checksum damage", () => {
		const publicKey = base32nopad.decode(sample("stellar")).slice(1, -2);
		expect(
			validateWalletAddress(
				stellar(96, Uint8Array.from([...publicKey, ...new Uint8Array(8)])),
				{ chain: "stellar" },
			),
		).toMatchObject({ status: "valid", format: "stellar-muxed" });
		expect(
			validateWalletAddress(stellar(16, publicKey), { chain: "stellar" }),
		).toMatchObject({ status: "valid", format: "stellar-contract" });
		expect(
			validateWalletAddress(stellar(144, publicKey), { chain: "stellar" })
				.status,
		).toBe("invalid");
	});
	test("TON recomputed CRC cannot disguise reserved flags or a network mismatch", () => {
		const source = valid.find(
			(entry) =>
				entry.chain === "ton" &&
				entry.address.length === 48 &&
				entry.network === "mainnet",
		);
		if (!source) throw new Error("Missing TON source");
		const body = base64urlnopad
			.decode(source.address.replaceAll("+", "-").replaceAll("/", "_"))
			.slice(0, 34);
		body[0] = 0x31;
		const crc = crc16(body);
		expect(
			validateWalletAddress(
				base64urlnopad.encode(Uint8Array.from([...body, crc >>> 8, crc & 255])),
				{ chain: "ton" },
			).status,
		).toBe("invalid");
		expect(
			validateWalletAddress(source.address, {
				chain: "ton",
				network: "testnet",
			}).status,
		).toBe("invalid");
		expect(
			validateWalletAddress(`2147483648:${"0".repeat(64)}`, { chain: "ton" })
				.status,
		).toBe("invalid");
	});
	test("source extraction accepts assignments and explorer URLs but not Base64 fragments", () => {
		const address = sample("evm");
		expect(cryptoAddressCandidates(`wallet=${address}`)).toContainEqual({
			kind: "eth",
			value: address,
			index: 7,
		});
		expect(
			cryptoAddressCandidates(`https://etherscan.io/address/${address}`),
		).toHaveLength(1);
		const sol = "S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH";
		expect(cryptoAddressCandidates(`https://example.com/${sol}+g==`)).toEqual(
			[],
		);
		expect(
			cryptoAddressCandidates(
				`sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/${sol}+g== wallet: ${address}`,
			),
		).toHaveLength(1);
	});
});
