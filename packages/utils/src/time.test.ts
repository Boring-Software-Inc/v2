import { expect, test } from "bun:test";
import { withTimeout } from "./time.ts";

test("bounded operations preserve values and failures and time out unresolved work", async () => {
	expect(await withTimeout(Promise.resolve("ready"), 50)).toBe("ready");
	await expect(
		withTimeout(Promise.reject(new Error("unavailable")), 50),
	).rejects.toThrow("unavailable");
	await expect(withTimeout(new Promise<never>(() => {}), 5)).rejects.toThrow(
		"operation-timeout",
	);
});
