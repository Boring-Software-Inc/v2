import {
	type ValidWalletAddress,
	type WalletAddressInspection,
	type WalletAddressObservation,
	type WalletChain,
	walletAddressObservationSchema,
} from "@tripwire/contracts/wallet-address";
import { backoffWithJitter } from "./retry.ts";
import { sleep } from "./time.ts";
import { validateWalletAddress } from "./wallet-address.ts";

export type WalletAddressReader = (
	address: Readonly<ValidWalletAddress>,
	context: { signal: AbortSignal },
) => Promise<unknown>;
export interface WalletAddressInspectorOptions {
	readers: Readonly<Partial<Record<WalletChain, WalletAddressReader>>>;
	timeoutMs?: number;
	cacheTtlMs?: number;
	maxCacheEntries?: number;
	maxInFlight?: number;
	maxConcurrent?: number;
	maxAttempts?: number;
	maxObservationAgeMs?: number;
	now?: () => number;
}

function bounded(
	value: number | undefined,
	fallback: number,
	maximum: number,
): number {
	const result = value ?? fallback;
	if (!Number.isInteger(result) || result < 1 || result > maximum)
		throw new RangeError(
			`Wallet inspector option must be an integer between 1 and ${maximum}.`,
		);
	return result;
}
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		promise.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				resolve(value);
			},
			(cause: unknown) => {
				signal.removeEventListener("abort", abort);
				reject(cause);
			},
		);
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
	});
}

/** Reader failures and empty chain reads never change the independently validated address format. */
export function createWalletAddressInspector(
	options: WalletAddressInspectorOptions,
) {
	const timeoutMs = bounded(options.timeoutMs, 8000, 60000);
	const cacheTtlMs = bounded(options.cacheTtlMs, 60000, 3600000);
	const maxCacheEntries = bounded(options.maxCacheEntries, 128, 10000);
	const maxInFlight = bounded(options.maxInFlight, 32, 1000);
	const maxConcurrent = bounded(options.maxConcurrent, 4, 32);
	const maxAttempts = bounded(options.maxAttempts, 2, 3);
	const maxObservationAgeMs = bounded(
		options.maxObservationAgeMs,
		60000,
		3600000,
	);
	const now = options.now ?? Date.now;
	const readers = { ...options.readers };
	const cache = new Map<
		string,
		{ expires: number; value: WalletAddressObservation }
	>();
	const inFlight = new Map<string, Promise<WalletAddressObservation>>();
	const queue = new Set<() => void>();
	let active = 0;
	function release(): void {
		active--;
		const next = queue.values().next().value;
		if (next) {
			queue.delete(next);
			next();
		}
	}
	function acquire(signal: AbortSignal): Promise<() => void> {
		if (signal.aborted) return Promise.reject(signal.reason);
		if (active < maxConcurrent) {
			active++;
			return Promise.resolve(release);
		}
		return new Promise((resolve, reject) => {
			const start = () => {
				signal.removeEventListener("abort", abort);
				active++;
				resolve(release);
			};
			const abort = () => {
				queue.delete(start);
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
			queue.add(start);
		});
	}
	function unavailable(
		address: ValidWalletAddress,
		reason: string,
	): WalletAddressObservation {
		return {
			chain: address.chain,
			network: address.network,
			address: address.canonicalAddress,
			checkedAt: new Date(now()).toISOString(),
			chainId: address.chainId,
			status: "unavailable",
			reason,
		};
	}
	async function run(
		address: ValidWalletAddress,
		reader: WalletAddressReader,
	): Promise<WalletAddressObservation> {
		const controller = new AbortController();
		const timer = setTimeout(
			() =>
				controller.abort(
					new DOMException("Wallet lookup timed out", "TimeoutError"),
				),
			timeoutMs,
		);
		let permit: (() => void) | undefined;
		try {
			permit = await acquire(controller.signal);
			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				let failure = "reader-error";
				try {
					const result = walletAddressObservationSchema.safeParse(
						await withSignal(
							Promise.resolve().then(() =>
								reader(structuredClone(address), { signal: controller.signal }),
							),
							controller.signal,
						),
					);
					if (
						result.success &&
						result.data.chain === address.chain &&
						result.data.chainId === address.chainId &&
						result.data.network === address.network &&
						result.data.address === address.canonicalAddress &&
						Date.parse(result.data.checkedAt) >= now() - maxObservationAgeMs &&
						Date.parse(result.data.checkedAt) <= now() + 1000
					) {
						if (
							result.data.status !== "unavailable" ||
							attempt + 1 === maxAttempts
						)
							return result.data;
					} else failure = "invalid-response";
				} catch {
					if (controller.signal.aborted) return unavailable(address, "timeout");
				}
				if (attempt + 1 === maxAttempts) return unavailable(address, failure);
				await withSignal(
					sleep(backoffWithJitter(attempt, { baseMs: 50, capMs: 200 })),
					controller.signal,
				);
			}
			return unavailable(address, "reader-error");
		} catch {
			return unavailable(
				address,
				controller.signal.aborted ? "timeout" : "reader-error",
			);
		} finally {
			clearTimeout(timer);
			permit?.();
		}
	}
	return async <AddressInput, RequestInput>(
		address: AddressInput,
		request: RequestInput,
		context?: { signal?: AbortSignal; fresh?: boolean },
	): Promise<WalletAddressInspection> => {
		const validation = validateWalletAddress(address, request);
		if (validation.status !== "valid") return { validation };
		if (context?.signal?.aborted)
			return { validation, activity: unavailable(validation, "aborted") };
		const reader = Object.hasOwn(readers, validation.chain)
			? readers[validation.chain]
			: undefined;
		if (!reader)
			return {
				validation,
				activity: {
					...unavailable(validation, "No chain reader is configured."),
					status: "unsupported",
				},
			};
		const key = `${validation.chain}:${validation.network}:${validation.chainId ?? ""}:${validation.canonicalAddress}`;
		const entry = cache.get(key);
		if (entry && entry.expires > now() && !context?.fresh) {
			cache.delete(key);
			cache.set(key, entry);
			return { validation, activity: structuredClone(entry.value) };
		}
		if (entry) cache.delete(key);
		let pending = inFlight.get(key);
		if (!pending) {
			if (inFlight.size >= maxInFlight)
				return {
					validation,
					activity: unavailable(validation, "lookup-capacity"),
				};
			pending = run(validation, reader)
				.then((activity) => {
					if (
						activity.status === "observed" ||
						activity.status === "not-observed"
					) {
						cache.set(key, {
							expires: now() + cacheTtlMs,
							value: structuredClone(activity),
						});
						if (cache.size > maxCacheEntries) {
							const oldest = cache.keys().next().value;
							if (oldest) cache.delete(oldest);
						}
					}
					return activity;
				})
				.finally(() => inFlight.delete(key));
			inFlight.set(key, pending);
		}
		try {
			return {
				validation,
				activity: structuredClone(
					await (context?.signal
						? withSignal(pending, context.signal)
						: pending),
				),
			};
		} catch {
			return { validation, activity: unavailable(validation, "aborted") };
		}
	};
}
