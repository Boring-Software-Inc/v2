import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
	ValidWalletAddress,
	WalletAddressObservation,
	WalletChain,
	WalletNetwork,
} from "@tripwire/contracts";
import {
	validateWalletAddress,
	WALLET_ADDRESS_CHAINS,
} from "./wallet-address.ts";
import {
	createWalletAddressInspector,
	type WalletAddressReader,
} from "./wallet-address-inspector.ts";

const CLOCK = Date.parse("2026-11-20T12:00:00.000Z");
const vectors: {
	chain: WalletChain;
	network: WalletNetwork;
	address: string;
}[] = await Bun.file(
	fileURLToPath(
		new URL("../fixtures/wallet-address-vectors.json", import.meta.url),
	),
).json();
function sample(
	chain: WalletChain,
	network: WalletNetwork = "mainnet",
): string {
	const vector = vectors.find(
		(item) =>
			item.chain === chain &&
			item.network === network &&
			validateWalletAddress(item.address, { chain, network }).status ===
				"valid",
	);
	if (!vector) throw new Error(`Missing captured vector: ${chain}/${network}`);
	return vector.address;
}
function observed(
	address: ValidWalletAddress,
	status: WalletAddressObservation["status"] = "observed",
): WalletAddressObservation {
	return {
		chain: address.chain,
		network: address.network,
		address: address.canonicalAddress,
		status,
		checkedAt: new Date(CLOCK).toISOString(),
		chainId: address.chainId,
	};
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("wallet inspector adapter contracts", () => {
	test("reader mutation cannot rewrite the validated identity", async () => {
		const original = sample("sui");
		const inspect = createWalletAddressInspector({
			readers: {
				sui: async (address) => {
					Object.assign(address, { canonicalAddress: `0x${"f".repeat(64)}` });
					return observed(address);
				},
			},
			now: () => CLOCK,
			maxAttempts: 1,
		});
		const result = await inspect(original, { chain: "sui" });
		expect(result.validation.status).toBe("valid");
		if (result.validation.status === "valid")
			expect(result.validation.canonicalAddress).toBe(original);
		expect(result.activity?.status).toBe("unavailable");
		expect(result.activity?.reason).toBe("invalid-response");
	});
	test("EVM ledgers share encoding but never share activity or cache identity", async () => {
		const chainIds: number[] = [];
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					chainIds.push(address.chainId ?? 0);
					return observed(address);
				},
			},
			now: () => CLOCK,
		});
		const ethereum = await inspect(sample("evm"), { chain: "ethereum" });
		const base = await inspect(sample("evm"), { chain: "base" });
		expect(ethereum.activity?.chainId).toBe(1);
		expect(base.activity?.chainId).toBe(8453);
		expect(chainIds).toEqual([1, 8453]);
	});
	for (const { chain } of WALLET_ADDRESS_CHAINS)
		for (const status of ["observed", "not-observed"] as const)
			test(`${chain}: ${status} never changes offline validity`, async () => {
				const reader: WalletAddressReader = async (address) =>
					observed(address, status);
				const inspect = createWalletAddressInspector({
					readers: { [chain]: reader },
					now: () => CLOCK,
				});
				const result = await inspect(sample(chain), { chain });
				expect(result.validation.status).toBe("valid");
				expect(result.activity).toMatchObject({ chain, status });
			});
	test("an unconfigured chain is unsupported, never labelled inactive", async () => {
		const result = await createWalletAddressInspector({
			readers: {},
			now: () => CLOCK,
		})(sample("monero"), { chain: "monero" });
		expect(result.validation.status).toBe("valid");
		expect(result.activity?.status).toBe("unsupported");
	});
	test("invalid addresses and unsupported requests make zero reader calls", async () => {
		let calls = 0;
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					return observed(address);
				},
			},
		});
		for (const address of [null, "", "0x123", "a".repeat(513)])
			expect(
				(await inspect(address, { chain: "evm" })).activity,
			).toBeUndefined();
		expect(
			(await inspect(sample("evm"), { chain: "constructor" })).validation
				.status,
		).toBe("unsupported");
		expect(calls).toBe(0);
	});
	test("network, chain, identity and malformed provider output cannot be substituted", async () => {
		for (const mutate of [
			(value: WalletAddressObservation) => ({ ...value, chain: "solana" }),
			(value: WalletAddressObservation) => ({ ...value, network: "testnet" }),
			(value: WalletAddressObservation) => ({
				...value,
				address: "someone-else",
			}),
			() => ({ status: "observed" }),
			(value: WalletAddressObservation) => ({
				...value,
				checkedAt: new Date(CLOCK - 3600000).toISOString(),
			}),
			(value: WalletAddressObservation) => ({
				...value,
				checkedAt: new Date(CLOCK + 3600000).toISOString(),
			}),
		]) {
			const inspect = createWalletAddressInspector({
				readers: { evm: async (address) => mutate(observed(address)) },
				maxAttempts: 1,
				now: () => CLOCK,
			});
			expect(
				(await inspect(sample("evm"), { chain: "evm" })).activity,
			).toMatchObject({ status: "unavailable", reason: "invalid-response" });
		}
	});
	test("canonical equivalents deduplicate simultaneous reads and protect cached evidence from mutation", async () => {
		let calls = 0;
		let finish: (() => void) | undefined;
		const ready = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					await ready;
					return observed(address);
				},
			},
			now: () => CLOCK,
		});
		const address = sample("evm");
		const first = inspect(address.toLowerCase(), { chain: "eth" });
		const second = inspect(address, { chain: "ethereum" });
		await tick();
		expect(calls).toBe(1);
		finish?.();
		const [left, right] = await Promise.all([first, second]);
		expect(left).toEqual(right);
		if (left.activity) left.activity.status = "not-observed";
		expect((await inspect(address, { chain: "evm" })).activity?.status).toBe(
			"observed",
		);
	});
	test("mainnet and testnet share a format but never share an activity cache entry", async () => {
		let calls = 0;
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					return observed(
						address,
						address.network === "mainnet" ? "observed" : "not-observed",
					);
				},
			},
			now: () => CLOCK,
		});
		expect(
			(await inspect(sample("evm"), { chain: "evm", network: "mainnet" }))
				.activity?.status,
		).toBe("observed");
		expect(
			(await inspect(sample("evm"), { chain: "evm", network: "testnet" }))
				.activity?.status,
		).toBe("not-observed");
		expect(calls).toBe(2);
	});
	test("empty observations expire so newly funded wallets can recover", async () => {
		let time = CLOCK;
		let calls = 0;
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					return observed(address, calls === 1 ? "not-observed" : "observed");
				},
			},
			cacheTtlMs: 10,
			now: () => time,
		});
		expect(
			(await inspect(sample("evm"), { chain: "evm" })).activity?.status,
		).toBe("not-observed");
		time += 11;
		expect(
			(await inspect(sample("evm"), { chain: "evm" })).activity?.status,
		).toBe("observed");
		expect(calls).toBe(2);
	});
	test("transient failures retry within a bound and failures do not poison later reads", async () => {
		let calls = 0;
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					if (calls <= 2) throw new Error("offline");
					return observed(address);
				},
			},
			now: () => CLOCK,
			maxAttempts: 2,
		});
		expect(
			(await inspect(sample("evm"), { chain: "evm" })).activity?.status,
		).toBe("unavailable");
		expect(calls).toBe(2);
		expect(
			(await inspect(sample("evm"), { chain: "evm" })).activity?.status,
		).toBe("observed");
		expect(calls).toBe(3);
	});
	test("timeouts release the slot and the next read has a fresh deadline", async () => {
		let calls = 0;
		let aborted = false;
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address, { signal }) => {
					calls++;
					if (calls === 1)
						await new Promise<void>((_, reject) =>
							signal.addEventListener(
								"abort",
								() => {
									aborted = true;
									reject(signal.reason);
								},
								{ once: true },
							),
						);
					return observed(address);
				},
			},
			timeoutMs: 25,
			maxAttempts: 1,
			maxConcurrent: 1,
			now: () => CLOCK,
		});
		expect(
			(await inspect(sample("evm"), { chain: "evm" })).activity,
		).toMatchObject({ status: "unavailable", reason: "timeout" });
		expect(aborted).toBe(true);
		expect(
			(await inspect(sample("evm"), { chain: "evm" })).activity?.status,
		).toBe("observed");
	});
	test("one cancelled waiter cannot cancel another waiter sharing its lookup", async () => {
		let finish: (() => void) | undefined;
		let calls = 0;
		const ready = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					await ready;
					return observed(address);
				},
			},
			now: () => CLOCK,
		});
		const controller = new AbortController();
		const first = inspect(
			sample("evm"),
			{ chain: "evm" },
			{ signal: controller.signal },
		);
		const second = inspect(sample("evm"), { chain: "evm" });
		controller.abort();
		expect((await first).activity).toMatchObject({
			status: "unavailable",
			reason: "aborted",
		});
		finish?.();
		expect((await second).activity?.status).toBe("observed");
		expect(calls).toBe(1);
	});
	test("a pre-cancelled request does not start I/O", async () => {
		let calls = 0;
		const controller = new AbortController();
		controller.abort();
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					return observed(address);
				},
			},
		});
		expect(
			(
				await inspect(
					sample("evm"),
					{ chain: "evm" },
					{ signal: controller.signal },
				)
			).activity?.reason,
		).toBe("aborted");
		expect(calls).toBe(0);
	});
	test("concurrency and queued work have hard limits", async () => {
		let active = 0;
		let peak = 0;
		let calls = 0;
		const releases: (() => void)[] = [];
		const inspect = createWalletAddressInspector({
			readers: {
				sui: async (address) => {
					active++;
					calls++;
					peak = Math.max(peak, active);
					await new Promise<void>((resolve) => releases.push(resolve));
					active--;
					return observed(address);
				},
			},
			maxConcurrent: 2,
			maxInFlight: 4,
			now: () => CLOCK,
		});
		const pending = Array.from({ length: 5 }, (_, index) =>
			inspect(`0x${index.toString(16).padStart(64, "0")}`, { chain: "sui" }),
		);
		await tick();
		expect(calls).toBe(2);
		for (let index = 0; index < 4; index++) {
			releases.shift()?.();
			await tick();
		}
		const results = await Promise.all(pending);
		expect(peak).toBe(2);
		expect(calls).toBe(4);
		expect(
			results.filter((result) => result.activity?.status === "observed"),
		).toHaveLength(4);
		expect(results[4]?.activity?.reason).toBe("lookup-capacity");
	});
	test("LRU capacity bounds retained evidence", async () => {
		let calls = 0;
		const inspect = createWalletAddressInspector({
			readers: {
				sui: async (address) => {
					calls++;
					return observed(address);
				},
			},
			maxCacheEntries: 1,
			now: () => CLOCK,
		});
		const first = `0x${"1".repeat(64)}`;
		const second = `0x${"2".repeat(64)}`;
		await inspect(first, { chain: "sui" });
		await inspect(second, { chain: "sui" });
		await inspect(first, { chain: "sui" });
		expect(calls).toBe(3);
	});
	test("callers can request a fresh observation without discarding validation", async () => {
		let calls = 0;
		const inspect = createWalletAddressInspector({
			readers: {
				evm: async (address) => {
					calls++;
					return observed(address);
				},
			},
			now: () => CLOCK,
		});
		await inspect(sample("evm"), { chain: "evm" });
		await inspect(sample("evm"), { chain: "evm" });
		await inspect(sample("evm"), { chain: "evm" }, { fresh: true });
		expect(calls).toBe(2);
	});
	test("invalid inspector limits fail at configuration, not during a lookup", () => {
		for (const timeoutMs of [0, -1, Number.POSITIVE_INFINITY, Number.NaN, 1.5])
			expect(() =>
				createWalletAddressInspector({ readers: {}, timeoutMs }),
			).toThrow(RangeError);
	});
});
