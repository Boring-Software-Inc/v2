import {
	bitcoinAddressActivityResponseSchema,
	type CryptoAddressActivity,
	type CryptoAddressKind,
	cryptoAddressActivitySchema,
	cryptoHexCodeSchema,
	cryptoHexQuantitySchema,
	cryptoRpcResponseSchema,
	solanaAccountActivityResponseSchema,
	solanaAddressSignaturesResponseSchema,
	type WalletAddressObservation,
	type WalletChain,
	type WalletNetwork,
} from "@tripwire/contracts";
import {
	createWalletAddressInspector,
	getErrorMessage,
	validateWalletAddress,
	type WalletAddressInspectorOptions,
	type WalletAddressReader,
} from "@tripwire/utils";
import type { Logger } from "pino";
import { z } from "zod";

const NETWORKS = {
	eth: "ethereum-mainnet",
	btc: "bitcoin-mainnet",
	sol: "solana-mainnet",
} as const;
const CHAINS = { eth: "evm", btc: "bitcoin", sol: "solana" } as const;
type ChainActivityEndpoints = Readonly<
	Partial<Record<WalletChain, Partial<Record<WalletNetwork, string>>>>
>;
const ENDPOINTS: ChainActivityEndpoints = {
	evm: {
		mainnet: "https://ethereum-rpc.publicnode.com",
		testnet: "https://ethereum-sepolia-rpc.publicnode.com",
	},
	bitcoin: {
		mainnet: "https://blockstream.info/api",
		testnet: "https://blockstream.info/testnet/api",
	},
	solana: {
		mainnet: "https://api.mainnet-beta.solana.com",
		testnet: "https://api.testnet.solana.com",
		devnet: "https://api.devnet.solana.com",
	},
};
const MAX_RESPONSE_BYTES = 128 * 1024;

type ActivityInspectorOptions = Omit<
	WalletAddressInspectorOptions,
	"readers"
> & { readers?: Partial<Record<WalletChain, WalletAddressReader>> };

async function readJson(response: Response): Promise<unknown> {
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Chain provider returned HTTP ${response.status}`);
	}
	const size = Number(response.headers.get("content-length"));
	if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) {
		await response.body?.cancel();
		throw new Error("Chain response exceeds byte limit");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Chain provider returned an empty body");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error("Chain response exceeds byte limit");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		<JsonValue>(
			_key: string,
			value: JsonValue,
			context?: { source?: string },
		) => {
			const number = z.number().safeParse(value);
			if (!number.success) {
				if (value === Infinity || value === -Infinity || Number.isNaN(value))
					throw new Error("Chain response contains a non-finite number");
				return value;
			}
			if (!Number.isFinite(value))
				throw new Error("Chain response contains a non-finite number");
			if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
				if (!context?.source || !/^-?\d+$/.test(context.source))
					throw new Error(
						"Chain response integer cannot be represented losslessly",
					);
				return context.source;
			}
			return value;
		},
	);
}

export function createWalletAddressActivityInspector(
	logger: Logger,
	fetcher: typeof fetch = fetch,
	options: ActivityInspectorOptions = {},
) {
	const now = options.now ?? Date.now;
	const read: WalletAddressReader = async (address, { signal }) => {
		const { chain, network, canonicalAddress: value } = address;
		const base = {
			chain,
			network,
			address: value,
			checkedAt: new Date(now()).toISOString(),
			chainId: address.chainId,
		};
		const ethereumSupported =
			chain !== "evm" ||
			address.chainId === (network === "mainnet" ? 1 : 11155111);
		const endpoint = ethereumSupported
			? ENDPOINTS[chain]?.[network]
			: undefined;
		if (!endpoint)
			return {
				...base,
				status: "unsupported",
				reason: "No provider is configured for this chain and network.",
			};
		const request = async (
			url: string,
			body?: { jsonrpc: "2.0"; id: number; method: string; params: unknown[] },
		): Promise<unknown> =>
			readJson(
				await fetcher(url, {
					method: body === undefined ? "GET" : "POST",
					headers: { "content-type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
					signal,
					redirect: "error",
				}),
			);
		const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
			const response = cryptoRpcResponseSchema.parse(
				await request(endpoint, { jsonrpc: "2.0", id: 1, method, params }),
			);
			if (response.error !== undefined || response.result === undefined)
				throw new Error(
					"Chain provider returned an RPC error or missing result",
				);
			return response.result;
		};
		try {
			if (chain === "solana") {
				const results = await Promise.allSettled([
					rpc("getAccountInfo", [
						value,
						{
							encoding: "base64",
							dataSlice: { offset: 0, length: 0 },
							commitment: "finalized",
						},
					]).then((result) =>
						solanaAccountActivityResponseSchema.parse(result),
					),
					rpc("getSignaturesForAddress", [
						value,
						{ limit: 1, commitment: "finalized" },
					]).then((result) =>
						solanaAddressSignaturesResponseSchema.parse(result),
					),
				]);
				const account =
					results[0].status === "fulfilled" ? results[0].value.value : null;
				const signatures =
					results[1].status === "fulfilled" ? results[1].value : [];
				const failures = results.filter(
					(result) => result.status === "rejected",
				);
				for (const failure of failures)
					logger.warn(
						{ chain, network, error: getErrorMessage(failure.reason) },
						"crypto address activity partially unavailable",
					);
				return {
					...base,
					status:
						account !== null || signatures.length > 0
							? "observed"
							: failures.length > 0
								? "unavailable"
								: "not-observed",
					balance: account ? String(account.lamports) : undefined,
					accountOwner: account?.owner,
					executable: account?.executable,
					transactionCount:
						results[1].status === "fulfilled" ? signatures.length : undefined,
					historyLimit: results[1].status === "fulfilled" ? 1 : undefined,
					reason:
						failures.length > 0
							? "One or more Solana activity reads were unavailable."
							: undefined,
				} satisfies WalletAddressObservation;
			}
			if (chain === "bitcoin") {
				const result = bitcoinAddressActivityResponseSchema.parse(
					await request(`${endpoint}/address/${encodeURIComponent(value)}`),
				);
				const transactionCount =
					result.chain_stats.tx_count + result.mempool_stats.tx_count;
				return {
					...base,
					status: transactionCount > 0 ? "observed" : "not-observed",
					transactionCount,
				} satisfies WalletAddressObservation;
			}
			const chainId = cryptoHexQuantitySchema.parse(
				await rpc("eth_chainId", []),
			);
			if (BigInt(chainId) !== (network === "mainnet" ? 1n : 11155111n))
				throw new Error("Provider returned a different EVM chain ID");
			const results = await Promise.allSettled([
				rpc("eth_getBalance", [value, "latest"]).then((result) =>
					cryptoHexQuantitySchema.parse(result),
				),
				rpc("eth_getTransactionCount", [value, "latest"]).then((result) =>
					cryptoHexQuantitySchema.parse(result),
				),
				rpc("eth_getCode", [value, "latest"]).then((result) =>
					cryptoHexCodeSchema.parse(result),
				),
			]);
			const balance =
				results[0].status === "fulfilled" ? BigInt(results[0].value) : null;
			const nonce =
				results[1].status === "fulfilled" ? BigInt(results[1].value) : null;
			const code = results[2].status === "fulfilled" ? results[2].value : null;
			const failures = results.filter((result) => result.status === "rejected");
			for (const failure of failures)
				logger.warn(
					{ chain, network, error: getErrorMessage(failure.reason) },
					"crypto address activity partially unavailable",
				);
			return {
				...base,
				status:
					(balance !== null && balance > 0n) ||
					(nonce !== null && nonce > 0n) ||
					(code !== null && code !== "0x")
						? "observed"
						: failures.length > 0
							? "unavailable"
							: "not-observed",
				balance: balance?.toString(),
				nonce: nonce?.toString(),
				codePresent: code !== null ? code !== "0x" : undefined,
				reason:
					failures.length > 0
						? "One or more EVM activity reads were unavailable."
						: undefined,
			} satisfies WalletAddressObservation;
		} catch (error) {
			logger.warn(
				{ chain, network, error: getErrorMessage(error) },
				"crypto address activity unavailable",
			);
			return {
				...base,
				status: "unavailable",
				reason: "Chain activity could not be read.",
			} satisfies WalletAddressObservation;
		}
	};
	return createWalletAddressInspector({
		...options,
		readers: { bitcoin: read, evm: read, solana: read, ...options.readers },
	});
}

/** The moderation context has a per-run lookup budget; reusable inspectors use expiring bounded caches. */
export function createCryptoAddressActivityReader(
	logger: Logger,
	fetcher: typeof fetch = fetch,
	options: ActivityInspectorOptions = {},
) {
	const inspect = createWalletAddressActivityInspector(
		logger,
		fetcher,
		options,
	);
	const seen = new Set<string>();
	const now = options.now ?? Date.now;
	return async (
		kind: CryptoAddressKind,
		value: string,
	): Promise<CryptoAddressActivity> => {
		const base = {
			kind,
			value,
			network: NETWORKS[kind],
			checkedAt: new Date(now()).toISOString(),
		};
		const validation = validateWalletAddress(value, {
			chain: CHAINS[kind],
			network: "mainnet",
		});
		if (validation.status !== "valid")
			return { ...base, status: "unavailable", reason: "invalid-address" };
		const key = `${kind}:${validation.canonicalAddress}`;
		if (!seen.has(key) && seen.size >= 12)
			return {
				...base,
				status: "unavailable",
				reason: "Address lookup limit reached.",
			};
		seen.add(key);
		const result = await inspect(value, {
			chain: CHAINS[kind],
			network: "mainnet",
		});
		const observation = result.activity;
		if (!observation)
			return {
				...base,
				status: "unavailable",
				reason: "Chain activity could not be read.",
			};
		const {
			chain: _chain,
			address: _address,
			network: _network,
			status,
			...fields
		} = observation;
		return cryptoAddressActivitySchema.parse({
			...base,
			...fields,
			status: status === "unsupported" ? "unavailable" : status,
		});
	};
}
