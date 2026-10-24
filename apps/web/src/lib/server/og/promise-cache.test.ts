import { describe, expect, test } from "bun:test";
import { promiseCache } from "#/lib/server/og/promise-cache";

describe("promiseCache", () => {
	test("a second request for the same key shares the first render", async () => {
		const cache = promiseCache<number>(2);
		let calls = 0;
		const make = async () => ++calls;
		const [a, b] = await Promise.all([cache("k", make), cache("k", make)]);
		expect([a, b, calls]).toEqual([1, 1, 1]);
	});

	test("the least recently used key is dropped past capacity", async () => {
		const cache = promiseCache<string>(2);
		let calls = 0;
		const make = (value: string) => async () => {
			calls++;
			return value;
		};
		await cache("a", make("a"));
		await cache("b", make("b"));
		await cache("a", make("a"));
		await cache("c", make("c"));
		await cache("a", make("a"));
		expect(calls).toBe(3);
		await cache("b", make("b"));
		expect(calls).toBe(4);
	});

	test("a failed render is not kept", async () => {
		const cache = promiseCache<string>(2);
		await expect(
			cache("k", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await cache("k", async () => "ok")).toBe("ok");
	});
});
