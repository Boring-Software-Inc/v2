import { describe, expect, test } from "bun:test";
import {
	addGithubCall,
	addOpenRouterBytesOut,
	getCounter,
	runWithCounter,
} from "./metering.ts";

/**
 * Per-run counters are scoped by AsyncLocalStorage: transport calls fold into
 * the active run's store and never leak across runs. Outside a scope, folds are
 * silent no-ops (metering observes, never participates).
 */
describe("run metering scope", () => {
	test("accumulates github + openrouter counts within a scope", async () => {
		const counter = await runWithCounter(async () => {
			addGithubCall({ bytesIn: 100, bytesOut: 20 });
			addGithubCall({ bytesIn: 50, bytesOut: 0 });
			addOpenRouterBytesOut(4096);
			return getCounter();
		});
		expect(counter).toEqual({
			githubApiCalls: 2,
			githubBytesIn: 150,
			githubBytesOut: 20,
			openrouterBytesOut: 4096,
		});
	});

	test("concurrent scopes do not bleed into each other", async () => {
		const [a, b] = await Promise.all([
			runWithCounter(async () => {
				addGithubCall({ bytesIn: 10, bytesOut: 1 });
				await new Promise((r) => setTimeout(r, 5));
				addGithubCall({ bytesIn: 10, bytesOut: 1 });
				return getCounter();
			}),
			runWithCounter(async () => {
				addOpenRouterBytesOut(999);
				return getCounter();
			}),
		]);
		expect(a?.githubApiCalls).toBe(2);
		expect(a?.openrouterBytesOut).toBe(0);
		expect(b?.githubApiCalls).toBe(0);
		expect(b?.openrouterBytesOut).toBe(999);
	});

	test("folds outside any scope are silent no-ops", () => {
		expect(() => addGithubCall({ bytesIn: 1, bytesOut: 1 })).not.toThrow();
		expect(getCounter()).toBeUndefined();
	});
});
