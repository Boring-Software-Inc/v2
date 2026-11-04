import { afterAll, expect, mock, test } from "bun:test";

const stagingId = "a512e6bc-385f-4b92-bceb-0692519edfc7";
const originalId = process.env.DATABUDDY_WEBSITE_ID;
const originalGate = process.env.ACCESS_GATE_ENABLED;
process.env.DATABUDDY_WEBSITE_ID = stagingId;
const configs: { clientId: string; cacheTtl?: number; apiUrl?: string }[] = [];
let result = { enabled: false, reason: "RULE_MATCH" };
let throws = false;
let calls = 0;
mock.module("@databuddy/sdk/node", () => ({
	createServerFlagsManager: (config: (typeof configs)[number]) => {
		configs.push(config);
		return {
			getFlag: async () => {
				calls += 1;
				if (throws) {
					throw new Error("mock transport unavailable");
				}
				return result;
			},
		};
	},
}));
const { isAccessGateEnabled } = await import("./access-gate.ts");
const { createFlagEvaluator } = await import("./flag-evaluation.ts");

afterAll(() => {
	mock.restore();
	if (originalId === undefined) delete process.env.DATABUDDY_WEBSITE_ID;
	else process.env.DATABUDDY_WEBSITE_ID = originalId;
	if (originalGate === undefined) delete process.env.ACCESS_GATE_ENABLED;
	else process.env.ACCESS_GATE_ENABLED = originalGate;
});

test("access gate uses staging and preserves resolved flags, fallback, and per-user caching", async () => {
	expect(configs[0]).toEqual({ clientId: stagingId });
	process.env.ACCESS_GATE_ENABLED = "true";
	expect(await isAccessGateEnabled({ userId: "resolved-off" })).toBe(false);
	result = { enabled: true, reason: "RULE_MATCH" };
	expect(await isAccessGateEnabled({ userId: "resolved-on" })).toBe(true);
	for (const reason of ["ERROR", "NOT_FOUND", "SESSION_PENDING"]) {
		result = { enabled: false, reason };
		expect(await isAccessGateEnabled({ userId: reason })).toBe(true);
	}
	throws = true;
	expect(await isAccessGateEnabled({ userId: "failed-closed" })).toBe(true);
	process.env.ACCESS_GATE_ENABLED = "false";
	expect(await isAccessGateEnabled({ userId: "failed-open" })).toBe(false);
	const before = calls;
	expect(await isAccessGateEnabled({ userId: "resolved-on" })).toBe(true);
	expect(calls).toBe(before);
	throws = false;
});

test("staff evaluator uses runtime staging ID, preserves endpoint/cache and error result", async () => {
	const evaluate = createFlagEvaluator({ apiUrl: "https://flags.test" });
	expect(configs.at(-1)).toEqual({
		clientId: stagingId,
		apiUrl: "https://flags.test",
		cacheTtl: 1,
	});
	result = { enabled: true, reason: "RULE_MATCH" };
	expect(await evaluate(["show-sidebar"], { userId: "staff" })).toEqual([
		{
			key: "show-sidebar",
			enabled: true,
			source: "rule",
			reason: "RULE_MATCH",
		},
	]);
	throws = true;
	expect(await evaluate(["show-sidebar"], { userId: "staff" })).toEqual([
		{ key: "show-sidebar", enabled: false, source: "unknown", reason: null },
	]);
	throws = false;
	delete process.env.DATABUDDY_WEBSITE_ID;
	createFlagEvaluator();
	expect(configs.at(-1)?.clientId).toBe("09661145-7249-45d9-a9e3-f1a93e9c7266");
});
