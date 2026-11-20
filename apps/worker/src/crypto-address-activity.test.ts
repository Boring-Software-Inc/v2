import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { z } from "zod";
import {
	createCryptoAddressActivityReader,
	createWalletAddressActivityInspector,
} from "./crypto-address-activity.ts";

const captures: {
	name: string;
	request?: { method: string; params: unknown[] };
	url: string;
	response: unknown;
}[] = await Bun.file(
	fileURLToPath(
		new URL("../fixtures/crypto-address-activity.json", import.meta.url),
	),
).json();
const logger = pino({ enabled: false });
const CANDIDATE = "S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH";
const ACTIVE_SOL = "Vote111111111111111111111111111111111111111";
const ETH = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

function capturedFetch(calls: string[] = []): typeof fetch {
	return (async (input: string | URL | Request, options?: RequestInit) => {
		const url = String(input);
		const request = z.string().safeParse(options?.body).success
			? (JSON.parse(z.string().parse(options?.body)) as {
					method: string;
					params: unknown[];
				})
			: undefined;
		calls.push(request?.method ?? url);
		const capture = captures.find(
			(item) =>
				item.url === url &&
				item.request?.method === request?.method &&
				JSON.stringify(item.request?.params) ===
					JSON.stringify(request?.params),
		);
		if (!capture) throw new Error("No captured response for request");
		return Response.json(capture.response);
	}) as typeof fetch;
}

describe("chain observations", () => {
	test("an EVM alias cannot silently query Ethereum when its own provider is unconfigured", async () => {
		let calls = 0;
		const fetcher = (async () => {
			calls++;
			throw new Error("No Ethereum request expected");
		}) as unknown as typeof fetch;
		const result = await createWalletAddressActivityInspector(logger, fetcher)(
			ETH,
			{ chain: "base" },
		);
		expect(result.validation).toMatchObject({ status: "valid", chainId: 8453 });
		expect(result.activity).toMatchObject({
			status: "unsupported",
			chainId: 8453,
		});
		expect(calls).toBe(0);
	});
	test("live mainnet and testnet captures replay without live network dependencies", async () => {
		const captured: {
			cases: {
				chain: string;
				network: string;
				address: string;
				result: { activity: { status: string } };
			}[];
			responses: {
				url: string;
				request?: { method: string; params: unknown[] };
				status: number;
				response: unknown;
			}[];
		} = await Bun.file(
			fileURLToPath(
				new URL(
					"../fixtures/wallet-address-network-captures.json",
					import.meta.url,
				),
			),
		).json();
		const fetcher = (async (
			input: string | URL | Request,
			options?: RequestInit,
		) => {
			const request = z.string().safeParse(options?.body).success
				? (JSON.parse(z.string().parse(options?.body)) as {
						method: string;
						params: unknown[];
					})
				: undefined;
			const found = captured.responses.find(
				(item) =>
					item.url === String(input) &&
					JSON.stringify(item.request) === JSON.stringify(request),
			);
			if (!found) throw new Error("No captured network response");
			return Response.json(found.response, { status: found.status });
		}) as typeof fetch;
		const inspect = createWalletAddressActivityInspector(logger, fetcher, {
			maxAttempts: 1,
		});
		for (const item of captured.cases) {
			const result = await inspect(item.address, {
				chain: item.chain,
				network: item.network,
			});
			expect(result.validation.status).toBe("valid");
			expect(result.activity).toMatchObject({
				chain: item.chain,
				network: item.network,
				status: item.result.activity.status,
			});
		}
	});
	test("one failed EVM read preserves independently observed balance or nonce", async () => {
		const real = capturedFetch();
		const fetcher = (async (
			input: string | URL | Request,
			options?: RequestInit,
		) => {
			if (String(options?.body).includes("eth_getCode"))
				return new Response("limited", { status: 429 });
			return real(input, options);
		}) as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher, {
				maxAttempts: 1,
			})("eth", ETH),
		).toMatchObject({
			status: "observed",
			reason: "One or more EVM activity reads were unavailable.",
		});
	});
	test("a wrong EVM chain ID never contributes activity evidence", async () => {
		let calls = 0;
		const fetcher = (async () => {
			calls++;
			return Response.json({ jsonrpc: "2.0", id: 1, result: "0x38" });
		}) as unknown as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher, {
				maxAttempts: 1,
			})("eth", ETH),
		).toMatchObject({ status: "unavailable" });
		expect(calls).toBe(1);
	});
	test("incomplete zero EVM readings are unavailable rather than inactive", async () => {
		const fetcher = (async (
			_input: string | URL | Request,
			options?: RequestInit,
		) => {
			const method = (JSON.parse(String(options?.body)) as { method: string })
				.method;
			if (method === "eth_getCode")
				return new Response("limited", { status: 429 });
			return Response.json({
				jsonrpc: "2.0",
				id: 1,
				result: method === "eth_chainId" ? "0x1" : "0x0",
			});
		}) as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher, {
				maxAttempts: 1,
			})("eth", ETH),
		).toMatchObject({ status: "unavailable" });
	});
	test("closed Solana accounts can still have observed transaction history", async () => {
		const real = capturedFetch();
		const fetcher = (async (
			input: string | URL | Request,
			options?: RequestInit,
		) => {
			if (String(options?.body).includes("getAccountInfo"))
				return Response.json(
					captures.find((item) => item.name === "sol-empty-account")?.response,
				);
			return real(input, options);
		}) as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher)(
				"sol",
				ACTIVE_SOL,
			),
		).toMatchObject({
			status: "observed",
			transactionCount: 1,
			historyLimit: 1,
		});
	});
	test("Solana u64 balances retain their exact decimal digits", async () => {
		const real = capturedFetch();
		const fetcher = (async (
			input: string | URL | Request,
			options?: RequestInit,
		) => {
			if (String(options?.body).includes("getAccountInfo"))
				return new Response(
					'{"jsonrpc":"2.0","id":1,"result":{"value":{"lamports":18446744073709551615,"owner":"11111111111111111111111111111111","executable":false}}}',
					{ headers: { "content-type": "application/json" } },
				);
			return real(input, options);
		}) as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher)(
				"sol",
				ACTIVE_SOL,
			),
		).toMatchObject({ status: "observed", balance: "18446744073709551615" });
	});
	test("oversized streaming responses are cancelled before parsing", async () => {
		let cancelled = 0;
		const fetcher = (async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array(128 * 1024 + 1));
					},
					cancel() {
						cancelled++;
					},
				}),
			)) as unknown as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher, {
				maxAttempts: 1,
			})("sol", CANDIDATE),
		).toMatchObject({ status: "unavailable" });
		expect(cancelled).toBe(2);
	});
	test("HTTP errors cancel their response bodies", async () => {
		let cancelled = 0;
		const fetcher = (async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					cancel() {
						cancelled++;
					},
				}),
				{ status: 503 },
			)) as unknown as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher, {
				maxAttempts: 1,
			})("sol", CANDIDATE),
		).toMatchObject({ status: "unavailable" });
		expect(cancelled).toBe(2);
	});
	test("a late lookup has a fresh deadline instead of inheriting an expired one", async () => {
		const read = createCryptoAddressActivityReader(logger, capturedFetch(), {
			timeoutMs: 50,
			maxAttempts: 1,
		});
		expect((await read("sol", CANDIDATE)).status).toBe("not-observed");
		await new Promise((resolve) => setTimeout(resolve, 70));
		expect((await read("sol", ACTIVE_SOL)).status).toBe("observed");
	});
	test("unconfigured providers do not issue requests or label wallets inactive", async () => {
		let calls = 0;
		const fetcher = (async () => {
			calls++;
			throw new Error("No request expected");
		}) as unknown as typeof fetch;
		const result = await createWalletAddressActivityInspector(logger, fetcher)(
			"GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB",
			{ chain: "stellar" },
		);
		expect(result.validation.status).toBe("valid");
		expect(result.activity?.status).toBe("unsupported");
		expect(calls).toBe(0);
	});
	test("the incident string has neither an account nor indexed history", async () => {
		const read = createCryptoAddressActivityReader(logger, capturedFetch());
		expect(await read("sol", CANDIDATE)).toMatchObject({
			status: "not-observed",
			network: "solana-mainnet",
			transactionCount: 0,
		});
	});

	test("records real account and transaction evidence for all supported chains", async () => {
		const read = createCryptoAddressActivityReader(logger, capturedFetch());
		expect(await read("sol", ACTIVE_SOL)).toMatchObject({
			status: "observed",
			executable: true,
		});
		expect(
			await read("btc", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"),
		).toMatchObject({ status: "observed", network: "bitcoin-mainnet" });
		expect(
			await read("eth", "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"),
		).toMatchObject({ status: "observed", network: "ethereum-mainnet" });
	});

	test("deduplicates reads and makes no request for invalid encodings", async () => {
		const calls: string[] = [];
		const read = createCryptoAddressActivityReader(
			logger,
			capturedFetch(calls),
		);
		await Promise.all([read("sol", CANDIDATE), read("sol", CANDIDATE)]);
		expect(calls).toHaveLength(2);
		await read("sol", "z".repeat(44));
		expect(calls).toHaveLength(2);
	});

	test("HTTP, RPC, malformed and aborted reads are unavailable, never inactive", async () => {
		for (const fetcher of [
			async () => new Response("limited", { status: 429 }),
			async () =>
				Response.json({
					jsonrpc: "2.0",
					id: 1,
					error: { code: -32000, message: "unavailable" },
				}),
			async () => Response.json({ result: [] }),
			async () => {
				throw new DOMException("timeout", "AbortError");
			},
		]) {
			const read = createCryptoAddressActivityReader(
				logger,
				fetcher as unknown as typeof fetch,
			);
			expect(await read("sol", CANDIDATE)).toMatchObject({
				status: "unavailable",
			});
		}
	});

	test("retains a positive account when the history provider fails", async () => {
		const real = capturedFetch();
		const fetcher = (async (
			input: string | URL | Request,
			options?: RequestInit,
		) => {
			if (String(options?.body).includes("getSignaturesForAddress"))
				return new Response("limited", { status: 429 });
			return real(input, options);
		}) as typeof fetch;
		expect(
			await createCryptoAddressActivityReader(logger, fetcher)(
				"sol",
				ACTIVE_SOL,
			),
		).toMatchObject({ status: "observed", executable: true });
	});
});
