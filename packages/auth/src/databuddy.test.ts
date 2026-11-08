import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

function runWithIsolatedFlags(assertions: string): void {
	const result = spawnSync(
		process.execPath,
		[
			"--no-env-file",
			"--eval",
			`
			import assert from "node:assert/strict";
			import { mock } from "bun:test";

			const stagingId = process.env.DATABUDDY_WEBSITE_ID;
			const configs = [];
			let result = { enabled: false, reason: "RULE_MATCH" };
			let throws = false;
			let calls = 0;

			mock.module("@databuddy/sdk/node", () => ({
				createServerFlagsManager: (config) => {
					configs.push(config);
					return {
						getFlag: async () => {
							calls += 1;
							if (throws) throw new Error("mock transport unavailable");
							return result;
						},
					};
				},
			}));

			${assertions}
			`,
		],
		{
			cwd: new URL(".", import.meta.url),
			env: {
				PATH: process.env.PATH,
				NODE_ENV: "test",
				DATABUDDY_WEBSITE_ID: "a512e6bc-385f-4b92-bceb-0692519edfc7",
			},
			encoding: "utf8",
		},
	);
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
}

test("access gate uses staging and preserves resolved flags, fallback, and per-user caching", () => {
	runWithIsolatedFlags(`
		const { isAccessGateEnabled } = await import("./access-gate.ts");
		assert.deepEqual(configs[0], { clientId: stagingId });

		process.env.ACCESS_GATE_ENABLED = "true";
		assert.equal(await isAccessGateEnabled({ userId: "resolved-off" }), false);
		result = { enabled: true, reason: "RULE_MATCH" };
		assert.equal(await isAccessGateEnabled({ userId: "resolved-on" }), true);
		for (const reason of ["ERROR", "NOT_FOUND", "SESSION_PENDING"]) {
			result = { enabled: false, reason };
			assert.equal(await isAccessGateEnabled({ userId: reason }), true);
		}

		throws = true;
		assert.equal(await isAccessGateEnabled({ userId: "failed-closed" }), true);
		process.env.ACCESS_GATE_ENABLED = "false";
		assert.equal(await isAccessGateEnabled({ userId: "failed-open" }), false);
		const before = calls;
		assert.equal(await isAccessGateEnabled({ userId: "resolved-on" }), true);
		assert.equal(calls, before);
	`);
});

test("staff evaluator uses runtime staging ID, preserves endpoint/cache and error result", () => {
	runWithIsolatedFlags(`
		const { createFlagEvaluator } = await import("./flag-evaluation.ts");
		const evaluate = createFlagEvaluator({ apiUrl: "https://flags.test" });
		assert.deepEqual(configs.at(-1), {
			clientId: stagingId,
			apiUrl: "https://flags.test",
			cacheTtl: 1,
		});
		result = { enabled: true, reason: "RULE_MATCH" };
		assert.deepEqual(await evaluate(["show-sidebar"], { userId: "staff" }), [
			{ key: "show-sidebar", enabled: true, source: "rule", reason: "RULE_MATCH" },
		]);

		throws = true;
		assert.deepEqual(await evaluate(["show-sidebar"], { userId: "staff" }), [
			{ key: "show-sidebar", enabled: false, source: "unknown", reason: null },
		]);

		delete process.env.DATABUDDY_WEBSITE_ID;
		createFlagEvaluator();
		assert.equal(configs.at(-1)?.clientId, "09661145-7249-45d9-a9e3-f1a93e9c7266");
	`);
});
