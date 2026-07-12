import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineRule, evaluateRule, ruleRef } from "./define.ts";
import { fixtureContext } from "./test-context.ts";

const echo = defineRule({
	id: "echo-test",
	version: 1,
	configSchema: z.object({ want: z.boolean() }),
	resultSchema: z.object({ got: z.boolean() }),
	remedy: "revise",
	evaluate(_ctx, config) {
		return {
			status: "evaluated",
			passed: config.want,
			evidence: { got: config.want },
		};
	},
});

const badEvidence = defineRule({
	id: "bad-evidence-test",
	version: 1,
	configSchema: z.object({}),
	resultSchema: z.object({ mustBeNumber: z.number() }),
	remedy: "revise",
	evaluate() {
		return {
			status: "evaluated",
			passed: true,
			evidence: { mustBeNumber: "not a number" } as never,
		};
	},
});

describe("evaluateRule envelope law (§6)", () => {
	test("evaluated results carry validated evidence and the wire identity", async () => {
		const result = await evaluateRule(echo, await fixtureContext(), {
			want: true,
		});
		expect(result).toMatchObject({
			ruleId: "echo-test",
			version: 1,
			status: "evaluated",
			passed: true,
			evidence: { got: true },
		});
		expect(Date.parse(result.evaluatedAt)).not.toBeNaN();
	});

	test("config parse failure ⇒ skipped envelope, never a throw", async () => {
		const result = await evaluateRule(echo, await fixtureContext(), {
			want: "yes",
		});
		expect(result.status).toBe("skipped");
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("invalid config");
	});

	test("evidence schema failure ⇒ skipped envelope — a rule cannot lie about its shape", async () => {
		const result = await evaluateRule(badEvidence, await fixtureContext(), {});
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("evidence failed schema");
	});

	test("ruleRef formats the wire id", () => {
		expect(ruleRef(echo)).toBe("echo-test@1");
	});
});
