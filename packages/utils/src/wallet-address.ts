import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
	base32nopad,
	base58,
	base58xrp,
	base64,
	base64urlnopad,
	bech32,
	bech32m,
	createBase58check,
} from "@scure/base";
import {
	type ValidWalletAddress,
	type WalletAddressValidation,
	type WalletChain,
	type WalletNetwork,
	walletAddressRequestSchema,
} from "@tripwire/contracts/wallet-address";
import { decode as decodeCbor, Tagged } from "cborg";
import { z } from "zod";

const CHECK58 = createBase58check(sha256);
const MAIN_TEST: WalletNetwork[] = ["mainnet", "testnet"];
const EVM_CHAIN_IDS = new Map<string, readonly [number, number]>([
	["base", [8453, 84532]],
	["arbitrum", [42161, 421614]],
	["optimism", [10, 11155420]],
	["polygon", [137, 80002]],
	["bnb", [56, 97]],
	["bsc", [56, 97]],
	["avalanche-c", [43114, 43113]],
]);
const BASE58_ALPHABET =
	"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const CASH_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
interface ParsedWalletAddress {
	format: string;
	canonicalAddress: string;
	compatibleNetworks: WalletNetwork[];
}
interface WalletChainDefinition {
	chain: WalletChain;
	aliases: readonly string[];
	networks: readonly WalletNetwork[];
	parse: (value: string) => ParsedWalletAddress | null;
}

function parsed(
	value: string,
	format: string,
	compatibleNetworks: WalletNetwork[] = MAIN_TEST,
): ParsedWalletAddress {
	return {
		canonicalAddress: value,
		format,
		compatibleNetworks: [...compatibleNetworks],
	};
}
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.length === right.length &&
		left.every((byte, index) => byte === right[index])
	);
}
function hex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function crc16(bytes: Uint8Array): number {
	let crc = 0;
	for (const byte of bytes) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit++)
			crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
	}
	return crc;
}
function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function parseEvm(value: string): ParsedWalletAddress | null {
	if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
	const body = value.slice(2);
	const lower = body.toLowerCase();
	const hash = hex(keccak_256(new TextEncoder().encode(lower)));
	const checksum = [...lower]
		.map((character, index) =>
			Number.parseInt(hash[index] ?? "0", 16) >= 8
				? character.toUpperCase()
				: character,
		)
		.join("");
	if (body !== lower && body !== body.toUpperCase() && body !== checksum)
		return null;
	return parsed(`0x${checksum}`, "evm-20-byte");
}
function parseUtxo(
	value: string,
	chain: "bitcoin" | "litecoin" | "dogecoin",
): ParsedWalletAddress | null {
	const configs = {
		bitcoin: {
			main: [0, 5],
			test: [111, 196],
			prefixes: { bc: ["mainnet"], tb: ["testnet"], bcrt: ["regtest"] },
		},
		litecoin: {
			main: [48, 50, 5],
			test: [111, 196, 58],
			prefixes: { ltc: ["mainnet"], tltc: ["testnet"], rltc: ["regtest"] },
		},
		dogecoin: { main: [30, 22], test: [113, 196], prefixes: {} },
	} satisfies Record<
		string,
		{
			main: number[];
			test: number[];
			prefixes: Record<string, WalletNetwork[]>;
		}
	>;
	const config = configs[chain];
	if (/^(?:bc|tb|bcrt|ltc|tltc|rltc)1/i.test(value)) {
		for (const [encoding, codec] of [
			["bech32", bech32],
			["bech32m", bech32m],
		] as const) {
			const decoded = codec.decodeUnsafe(value, 90);
			if (!decoded) continue;
			const network = Object.entries(config.prefixes).find(
				([prefix]) => prefix === decoded.prefix,
			)?.[1];
			const version = decoded.words[0] ?? 17;
			const program = codec.fromWordsUnsafe(decoded.words.slice(1));
			if (
				!network ||
				!program ||
				version > 16 ||
				program.length < 2 ||
				program.length > 40
			)
				return null;
			if (
				version === 0
					? encoding !== "bech32" ||
						(program.length !== 20 && program.length !== 32)
					: encoding !== "bech32m"
			)
				return null;
			return parsed(
				value.toLowerCase(),
				version === 0
					? "segwit-v0"
					: version === 1 && program.length === 32
						? "taproot"
						: `segwit-v${version}`,
				network,
			);
		}
		return null;
	}
	const body = CHECK58.decode(value);
	if (body.length !== 21) return null;
	const version = body[0] ?? -1;
	const networks: WalletNetwork[] = config.main.includes(version)
		? ["mainnet"]
		: config.test.includes(version)
			? ["testnet", "regtest"]
			: [];
	if (networks.length === 0) return null;
	return parsed(
		value,
		config.main[1] === version || version === 196 || version === 58
			? "p2sh"
			: "p2pkh",
		networks,
	);
}
function parseXrp(value: string): ParsedWalletAddress | null {
	const bytes = base58xrp.decode(value);
	const body = bytes.slice(0, -4);
	if (!bytesEqual(bytes.slice(-4), sha256(sha256(body)).slice(0, 4)))
		return null;
	if (body.length === 21 && body[0] === 0) return parsed(value, "xrp-classic");
	if (body.length !== 31) return null;
	const network =
		body[0] === 5 && body[1] === 68
			? "mainnet"
			: body[0] === 4 && body[1] === 147
				? "testnet"
				: null;
	const flag = body[22];
	if (
		!network ||
		(flag !== 0 && flag !== 1) ||
		body.slice(27).some((byte) => byte !== 0) ||
		(flag === 0 && body.slice(23).some((byte) => byte !== 0))
	)
		return null;
	return parsed(value, "xrp-x-address", [network]);
}
function parseShelley(value: string): ParsedWalletAddress | null {
	const decoded = bech32.decodeUnsafe(value, 200);
	if (!decoded) return null;
	const bytes = bech32.fromWordsUnsafe(decoded.words);
	if (!bytes?.length) return null;
	const header = bytes[0] ?? 0;
	const type = header >>> 4;
	const id = header & 15;
	const network: WalletNetwork | null =
		id === 1 ? "mainnet" : id === 0 ? "testnet" : null;
	if (!network) return null;
	const stake = type === 14 || type === 15;
	const expectedPrefix = `${stake ? "stake" : "addr"}${network === "testnet" ? "_test" : ""}`;
	if (decoded.prefix !== expectedPrefix) return null;
	if (
		type <= 3
			? bytes.length !== 57
			: type === 6 || type === 7 || stake
				? bytes.length !== 29
				: type === 4 || type === 5
					? bytes.length < 32
					: true
	)
		return null;
	if (type === 4 || type === 5) {
		let offset = 29;
		for (let part = 0; part < 3; part++) {
			const start = offset;
			let accumulated = 0n;
			while (offset < bytes.length) {
				const byte = bytes[offset++] ?? 0;
				if (offset - start > 10 || (offset === start + 1 && byte === 128))
					return null;
				accumulated = (accumulated << 7n) | BigInt(byte & 127);
				if (accumulated > 0xffffffffffffffffn) return null;
				if ((byte & 128) === 0) break;
			}
			if (offset === start || ((bytes[offset - 1] ?? 128) & 128) !== 0)
				return null;
		}
		if (offset !== bytes.length) return null;
	}
	return parsed(
		value.toLowerCase(),
		stake
			? "cardano-stake"
			: type <= 3
				? "cardano-base"
				: type <= 5
					? "cardano-pointer"
					: "cardano-enterprise",
		[network],
	);
}
function parseCardano(value: string): ParsedWalletAddress | null {
	if (/^(?:addr|stake)/i.test(value)) return parseShelley(value);
	const options = {
		useMaps: true,
		rejectDuplicateMapKeys: true,
		allowIndefinite: false,
		strict: true,
		tags: Tagged.preserve(24),
	};
	const container: unknown = decodeCbor(base58.decode(value), options);
	if (
		!Array.isArray(container) ||
		container.length !== 2 ||
		!(container[0] instanceof Tagged) ||
		container[0].tag !== 24 ||
		!(container[0].value instanceof Uint8Array) ||
		!Number.isInteger(container[1]) ||
		crc32(container[0].value) !== container[1]
	)
		return null;
	const payload: unknown = decodeCbor(container[0].value, {
		...options,
		tags: {},
	});
	if (
		!Array.isArray(payload) ||
		payload.length !== 3 ||
		!(payload[0] instanceof Uint8Array) ||
		payload[0].length !== 28 ||
		!(payload[1] instanceof Map) ||
		![0, 1, 2].includes(payload[2])
	)
		return null;
	const attributes: Map<unknown, unknown> = payload[1];
	const magic = attributes.get(2);
	if (magic !== undefined) {
		if (!(magic instanceof Uint8Array)) return null;
		const identifier: unknown = decodeCbor(magic);
		if (!z.number().int().min(0).max(0xffffffff).safeParse(identifier).success)
			return null;
	}
	return parsed(value, "cardano-byron", [
		magic === undefined ? "mainnet" : "testnet",
	]);
}
function cashPolymod(values: readonly number[]): bigint {
	const generators = [
		0x98f2bc8e61n,
		0x79b76d99e2n,
		0xf33e5fb3c4n,
		0xae2eabe2a8n,
		0x1e4f43e470n,
	];
	let checksum = 1n;
	for (const digit of values) {
		const high = checksum >> 35n;
		checksum = ((checksum & 0x7ffffffffn) << 5n) ^ BigInt(digit);
		for (let i = 0; i < 5; i++)
			if ((high >> BigInt(i)) & 1n) checksum ^= generators[i] ?? 0n;
	}
	return checksum ^ 1n;
}
function parseCash(value: string): ParsedWalletAddress | null {
	if (!value.includes(":") && /^[13mn2]/.test(value))
		return parseUtxo(value, "bitcoin");
	if (value !== value.toLowerCase() && value !== value.toUpperCase())
		return null;
	const lower = value.toLowerCase();
	const parts = lower.split(":");
	if (parts.length > 2) return null;
	const payload = parts.at(-1) ?? "";
	const words = [...payload].map((character) =>
		CASH_ALPHABET.indexOf(character),
	);
	if (words.some((word) => word < 0) || words.length < 9) return null;
	const prefixes =
		parts.length === 2
			? [parts[0] ?? ""]
			: ["bitcoincash", "bchtest", "bchreg"];
	for (const prefix of prefixes) {
		const network =
			prefix === "bitcoincash"
				? "mainnet"
				: prefix === "bchtest"
					? "testnet"
					: prefix === "bchreg"
						? "regtest"
						: null;
		if (
			!network ||
			cashPolymod(
				[...prefix]
					.map((character) => character.charCodeAt(0) & 31)
					.concat(0, words),
			) !== 0n
		)
			continue;
		const data = bech32.fromWordsUnsafe(words.slice(0, -8));
		if (!data?.length) return null;
		const version = data[0] ?? 128;
		const type = version >>> 3;
		const sizes = [20, 24, 28, 32, 40, 48, 56, 64];
		if (
			version >= 128 ||
			![0, 1, 2, 3].includes(type) ||
			data.length !== 1 + (sizes[version & 7] ?? 0)
		)
			return null;
		return parsed(
			`${prefix}:${payload}`,
			type >= 2 ? "cashaddr-token-aware" : "cashaddr",
			[network],
		);
	}
	if (parts.length === 1 && /^[13mn2]/.test(value))
		return parseUtxo(value, "bitcoin");
	return null;
}
function parseTon(value: string): ParsedWalletAddress | null {
	if (/^-?(?:0|[1-9]\d*):[0-9a-fA-F]{64}$/.test(value)) {
		const workchain = Number(value.slice(0, value.indexOf(":")));
		return workchain >= -2147483648 && workchain <= 2147483647
			? parsed(value.toLowerCase(), "ton-raw")
			: null;
	}
	if (!/^(?:[A-Za-z0-9_-]{48}|[A-Za-z0-9+/]{48})$/.test(value)) return null;
	const bytes =
		value.includes("-") || value.includes("_")
			? base64urlnopad.decode(value)
			: base64.decode(value);
	if (bytes.length !== 36) return null;
	const flag = bytes[0] ?? 0;
	if ((flag & 127) !== 17 && (flag & 127) !== 81) return null;
	const crc = crc16(bytes.slice(0, 34));
	if (bytes[34] !== crc >>> 8 || bytes[35] !== (crc & 255)) return null;
	return parsed(
		base64urlnopad.encode(bytes),
		(flag & 127) === 17 ? "ton-bounceable" : "ton-non-bounceable",
		[flag & 128 ? "testnet" : "mainnet"],
	);
}
function parseStellar(value: string): ParsedWalletAddress | null {
	if (!/^[A-Z2-7]+$/.test(value)) return null;
	const bytes = base32nopad.decode(value);
	const version = bytes[0];
	if (
		version === 48 || version === 16
			? bytes.length !== 35
			: version === 96
				? bytes.length !== 43
				: true
	)
		return null;
	const crc = crc16(bytes.slice(0, -2));
	if (bytes.at(-2) !== (crc & 255) || bytes.at(-1) !== crc >>> 8) return null;
	return parsed(
		value,
		version === 96
			? "stellar-muxed"
			: version === 16
				? "stellar-contract"
				: "stellar-account",
	);
}
function parseMonero(value: string): ParsedWalletAddress | null {
	if (value.length !== 95 && value.length !== 106) return null;
	const data: number[] = [];
	const sizes = new Map([
		[2, 1],
		[3, 2],
		[5, 3],
		[6, 4],
		[7, 5],
		[9, 6],
		[10, 7],
		[11, 8],
	]);
	for (let offset = 0; offset < value.length; offset += 11) {
		const block = value.slice(offset, offset + 11);
		const length = sizes.get(block.length);
		if (!length) return null;
		let number = 0n;
		for (const character of block) {
			const digit = BASE58_ALPHABET.indexOf(character);
			if (digit < 0) return null;
			number = number * 58n + BigInt(digit);
		}
		if (number >= 1n << BigInt(length * 8)) return null;
		const decoded = Array<number>(length).fill(0);
		for (let i = length - 1; i >= 0; i--) {
			decoded[i] = Number(number & 255n);
			number >>= 8n;
		}
		data.push(...decoded);
	}
	const bytes = Uint8Array.from(data);
	const prefix = bytes[0];
	const network = [18, 19, 42].includes(prefix ?? -1)
		? "mainnet"
		: [53, 54, 63].includes(prefix ?? -1)
			? "testnet"
			: [24, 25, 36].includes(prefix ?? -1)
				? "stagenet"
				: null;
	const integrated = prefix === 19 || prefix === 54 || prefix === 25;
	if (
		!network ||
		bytes.length !== (integrated ? 77 : 69) ||
		!bytesEqual(bytes.slice(-4), keccak_256(bytes.slice(0, -4)).slice(0, 4))
	)
		return null;
	return parsed(
		value,
		integrated
			? "monero-integrated"
			: prefix === 42 || prefix === 63 || prefix === 36
				? "monero-subaddress"
				: "monero-standard",
		[network],
	);
}
function parsePolkadot(value: string): ParsedWalletAddress | null {
	const bytes = base58.decode(value);
	const prefix = bytes[0];
	if (prefix !== 0 && prefix !== 42) return null;
	const sizes = new Map([
		[3, [1, 1]],
		[4, [2, 1]],
		[5, [2, 2]],
		[6, [4, 1]],
		[7, [4, 2]],
		[8, [4, 3]],
		[9, [4, 4]],
		[10, [8, 1]],
		[11, [8, 2]],
		[12, [8, 3]],
		[13, [8, 4]],
		[14, [8, 5]],
		[15, [8, 6]],
		[16, [8, 7]],
		[17, [8, 8]],
		[34, [32, 2]],
	]);
	const format = sizes.get(bytes.length - 1);
	if (!format) return null;
	const checksumLength = format[1] ?? 0;
	const body = bytes.slice(0, -checksumLength);
	const preimage = new Uint8Array(7 + body.length);
	preimage.set(new TextEncoder().encode("SS58PRE"));
	preimage.set(body, 7);
	if (
		!bytesEqual(
			bytes.slice(-checksumLength),
			blake2b(preimage, { dkLen: 64 }).slice(0, checksumLength),
		)
	)
		return null;
	return parsed(
		value,
		format[0] === 32 ? "ss58-account" : "ss58-index",
		prefix === 0 ? ["mainnet"] : ["mainnet", "testnet"],
	);
}
function parseTezos(value: string): ParsedWalletAddress | null {
	const bytes = CHECK58.decode(value);
	const prefixes = [
		[6, 161, 159],
		[6, 161, 161],
		[6, 161, 164],
		[6, 161, 166],
		[2, 90, 121],
		[6, 124, 117],
	];
	const index = prefixes.findIndex(
		(prefix) =>
			bytes.length === prefix.length + 20 &&
			prefix.every((byte, position) => bytes[position] === byte),
	);
	return index < 0
		? null
		: parsed(
				value,
				[
					"tezos-tz1",
					"tezos-tz2",
					"tezos-tz3",
					"tezos-tz4",
					"tezos-contract",
					"tezos-rollup",
				][index] ?? "tezos",
			);
}
const DEFINITIONS: readonly WalletChainDefinition[] = [
	{
		chain: "bitcoin",
		aliases: ["btc"],
		networks: ["mainnet", "testnet", "regtest"],
		parse: (value) => parseUtxo(value, "bitcoin"),
	},
	{
		chain: "evm",
		aliases: [
			"eth",
			"ethereum",
			"base",
			"arbitrum",
			"optimism",
			"polygon",
			"bnb",
			"bsc",
			"avalanche-c",
		],
		networks: MAIN_TEST,
		parse: parseEvm,
	},
	{
		chain: "solana",
		aliases: ["sol", "spl"],
		networks: ["mainnet", "testnet", "devnet"],
		parse: (value) =>
			base58.decode(value).length === 32
				? parsed(value, "solana-public-key", ["mainnet", "testnet", "devnet"])
				: null,
	},
	{
		chain: "tron",
		aliases: ["trx", "trc20"],
		networks: MAIN_TEST,
		parse: (value) => {
			const text = value.replace(/^0x/i, "");
			const bytes = /^41[0-9a-fA-F]{40}$/.test(text)
				? Uint8Array.from(text.match(/../g) ?? [], (byte) =>
						Number.parseInt(byte, 16),
					)
				: CHECK58.decode(value);
			return bytes.length === 21 && bytes[0] === 65
				? parsed(CHECK58.encode(bytes), "tron-base58check")
				: null;
		},
	},
	{ chain: "xrp", aliases: ["ripple"], networks: MAIN_TEST, parse: parseXrp },
	{
		chain: "cardano",
		aliases: ["ada"],
		networks: MAIN_TEST,
		parse: parseCardano,
	},
	{
		chain: "litecoin",
		aliases: ["ltc"],
		networks: ["mainnet", "testnet", "regtest"],
		parse: (value) => parseUtxo(value, "litecoin"),
	},
	{
		chain: "dogecoin",
		aliases: ["doge"],
		networks: ["mainnet", "testnet", "regtest"],
		parse: (value) => parseUtxo(value, "dogecoin"),
	},
	{
		chain: "bitcoin-cash",
		aliases: ["bch", "bitcoincash", "bitcoin cash"],
		networks: ["mainnet", "testnet", "regtest"],
		parse: parseCash,
	},
	{
		chain: "cosmos",
		aliases: ["atom"],
		networks: MAIN_TEST,
		parse: (value) => {
			const decoded = bech32.decodeUnsafe(value, 100);
			const data = decoded ? bech32.fromWordsUnsafe(decoded.words) : undefined;
			return decoded?.prefix === "cosmos" &&
				data &&
				[20, 32].includes(data.length)
				? parsed(value.toLowerCase(), "cosmos-account")
				: null;
		},
	},
	{ chain: "ton", aliases: [], networks: MAIN_TEST, parse: parseTon },
	{
		chain: "sui",
		aliases: [],
		networks: ["mainnet", "testnet", "devnet"],
		parse: (value) =>
			/^0x[0-9a-fA-F]{64}$/.test(value)
				? parsed(value.toLowerCase(), "sui-32-byte", [
						"mainnet",
						"testnet",
						"devnet",
					])
				: null,
	},
	{
		chain: "stellar",
		aliases: ["xlm"],
		networks: MAIN_TEST,
		parse: parseStellar,
	},
	{
		chain: "monero",
		aliases: ["xmr"],
		networks: ["mainnet", "testnet", "stagenet"],
		parse: parseMonero,
	},
	{
		chain: "polkadot",
		aliases: ["dot"],
		networks: MAIN_TEST,
		parse: parsePolkadot,
	},
	{
		chain: "tezos",
		aliases: ["xtz", "tez"],
		networks: MAIN_TEST,
		parse: parseTezos,
	},
];
export const WALLET_ADDRESS_CHAINS = Object.freeze(
	DEFINITIONS.map(({ chain, aliases, networks }) =>
		Object.freeze({
			chain,
			aliases: Object.freeze([...aliases]),
			networks: Object.freeze([...networks]),
		}),
	),
);

/** Validity is a local encoding check. Shared encodings cannot establish a chain, owner or account's existence. */
export function validateWalletAddress<AddressInput, OptionsInput>(
	address: AddressInput,
	options: OptionsInput,
): WalletAddressValidation {
	try {
		const parsedOptions = walletAddressRequestSchema
			.omit({ address: true })
			.safeParse(options);
		if (!parsedOptions.success)
			return { status: "invalid", reason: "invalid-input" };
		const request = walletAddressRequestSchema.safeParse({
			...parsedOptions.data,
			address,
		});
		if (!request.success) return { status: "invalid", reason: "invalid-input" };
		const name = request.data.chain.toLowerCase();
		const definition = DEFINITIONS.find(
			(item) => item.chain === name || item.aliases.includes(name),
		);
		if (!definition) return { status: "unsupported", reason: "chain" };
		if (!definition.networks.includes(request.data.network))
			return { status: "unsupported", reason: "network" };
		const result = definition.parse(request.data.address);
		if (!result) return { status: "invalid", reason: "invalid-address" };
		if (!result.compatibleNetworks.includes(request.data.network))
			return { status: "invalid", reason: "network-mismatch" };
		return {
			status: "valid",
			chain: definition.chain,
			network: request.data.network,
			chainId:
				definition.chain === "evm"
					? (EVM_CHAIN_IDS.get(name) ?? [1, 11155111])[
							request.data.network === "mainnet" ? 0 : 1
						]
					: undefined,
			...result,
			networkDiscrimination:
				result.compatibleNetworks.length === 1 ? "encoded" : "shared",
		} satisfies ValidWalletAddress;
	} catch {
		return { status: "invalid", reason: "invalid-address" };
	}
}
