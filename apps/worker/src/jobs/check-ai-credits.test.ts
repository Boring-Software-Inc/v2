import { describe, expect, test } from "bun:test";
import type { AiCreditsState } from "@tripwire/contracts";
import pino from "pino";
import { checkAiCredits } from "./check-ai-credits.ts";

const logger = pino({ level: "silent" });

function harness(responses: Record<string, { status: number; body: unknown }>) {
	const calls: { url: string; auth: string | null }[] = [];
	const recorded: AiCreditsState[] = [];
	const reports: string[] = [];
	const fetchImpl = (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const url = String(input);
		const headers = new Headers(init?.headers);
		calls.push({ url, auth: headers.get("authorization") });
		const found = responses[url];
		return Promise.resolve(
			found
				? Response.json(found.body, { status: found.status })
				: new Response("nope", { status: 404 }),
		);
	};
	return {
		calls,
		recorded,
		reports,
		deps: {
			logger,
			fetch: fetchImpl,
			record: (state: AiCreditsState) => {
				const changed = recorded.at(-1) !== state;
				recorded.push(state);
				return Promise.resolve({ changed });
			},
			report: (context: { source: string }) => {
				reports.push(context.source);
			},
		},
	};
}

const CREDITS = "https://openrouter.ai/api/v1/credits";
const KEY = "https://openrouter.ai/api/v1/key";

describe("the AI credit check", () => {
	test("an empty account reads out, with the management key on /credits", async () => {
		const h = harness({
			[CREDITS]: {
				status: 200,
				body: { data: { total_credits: 20, total_usage: 19.99 } },
			},
			[KEY]: { status: 200, body: { data: { limit: null, usage: 19.99 } } },
		});
		expect(
			await checkAiCredits(h.deps, {
				inferenceKey: "sk-inference",
				managementKey: "sk-management",
			}),
		).toBe("out");
		expect(h.recorded).toEqual(["out"]);
		expect(h.reports).toHaveLength(1);
		expect(h.calls).toContainEqual({
			url: CREDITS,
			auth: "Bearer sk-management",
		});
		expect(h.calls).toContainEqual({ url: KEY, auth: "Bearer sk-inference" });
	});

	test("a topped-up account reads ready", async () => {
		const h = harness({
			[CREDITS]: {
				status: 200,
				body: { data: { total_credits: 50, total_usage: 20 } },
			},
		});
		expect(
			await checkAiCredits(h.deps, {
				inferenceKey: null,
				managementKey: "sk-management",
			}),
		).toBe("ready");
		expect(h.recorded).toEqual(["ready"]);
		expect(h.reports).toHaveLength(0);
	});

	test("a key at its own limit reads out without a management key", async () => {
		const h = harness({
			[KEY]: {
				status: 200,
				body: { data: { limit: 5, limit_remaining: 0, usage: 5 } },
			},
		});
		expect(
			await checkAiCredits(h.deps, {
				inferenceKey: "sk-inference",
				managementKey: null,
			}),
		).toBe("out");
	});

	test("no balance to read leaves the state to the runs", async () => {
		const h = harness({
			[KEY]: { status: 200, body: { data: { limit: null, usage: 3 } } },
			[CREDITS]: { status: 500, body: {} },
		});
		expect(
			await checkAiCredits(h.deps, {
				inferenceKey: "sk-inference",
				managementKey: "sk-management",
			}),
		).toBe("unknown");
		expect(h.recorded).toEqual([]);
	});

	test("no keys at all does nothing", async () => {
		const h = harness({});
		expect(
			await checkAiCredits(h.deps, { inferenceKey: null, managementKey: null }),
		).toBe("unknown");
		expect(h.calls).toEqual([]);
	});
});
