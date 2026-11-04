import { describe, expect, test } from "bun:test";
import { actionDone, actionEffect, listWords } from "./action-words.ts";
import type { WebhookPayload } from "./webhook-payload.ts";

describe("action words", () => {
	test("an action says what it does, naming its labels", () => {
		expect(actionEffect("label", { labels: ["stale"] })).toBe(
			"adds the label stale",
		);
		expect(actionEffect("label", { labels: ["a", "b"] })).toBe(
			"adds the labels a and b",
		);
		expect(actionEffect("remove-label", { labels: ["wip"] })).toBe(
			"removes the label wip",
		);
		expect(actionEffect("post-comment", { message: "hi" })).toBe(
			"posts your comment",
		);
		expect(
			actionEffect("request-review", {
				reviewers: ["octocat"],
				teamReviewers: [],
			}),
		).toBe("requests GitHub review from octocat");
		expect(actionEffect("close", {})).toBe("closes it");
	});

	test("a done action reads as a chip that says what it added", () => {
		expect(actionDone("label", { labels: ["needs-a-human"] })).toBe(
			"Labeled needs-a-human",
		);
		expect(actionDone("label", { labels: ["human-approved"] })).not.toBe(
			actionDone("label", { labels: ["needs-a-human"] }),
		);
		expect(actionDone("comment", {})).toBe("Verdict comment");
		expect(actionDone("post-comment", { message: "x" })).toBe(
			"Workflow comment",
		);
		expect(actionDone("set-check", {})).toBeNull();
	});

	test("lists join the way a person writes them", () => {
		expect(listWords(["a"])).toBe("a");
		expect(listWords(["a", "b", "c"])).toBe("a, b and c");
	});
});

describe("persisted action read contracts", () => {
	test("JSON records retain every extra field without substituting an empty object", async () => {
		const { storedActionPayloadSchema } = await import("./action-words.ts");
		const payload = { reason: "stored", extra: [null, { keep: true }] };
		expect(storedActionPayloadSchema.parse(payload)).toEqual(payload);
		for (const invalid of [null, [], false, 12, "payload"]) {
			expect(storedActionPayloadSchema.safeParse(invalid).success).toBe(false);
		}
	});

	test("forge execution validates consumed fields and rejects unknown kinds", async () => {
		const { persistedForgeActionSchema } = await import("./action-words.ts");
		for (const action of [
			{ kind: "set-check", payload: { sha: "head" } },
			{ kind: "comment", payload: { body: 3, verdict: "block" } },
			{ kind: "label", payload: { labels: [3] } },
			{ kind: "block", payload: { reason: null } },
			{ kind: "unknown", payload: {} },
		])
			expect(persistedForgeActionSchema.safeParse(action).success).toBe(false);
		expect(
			persistedForgeActionSchema.parse({
				kind: "label",
				payload: { labels: [" keep spaces "], extra: null },
			}),
		).toEqual({ kind: "label", payload: { labels: [" keep spaces "] } });
	});

	test("GitCafe payload reads retain JSON extras and reject non-JSON extras", async () => {
		const { gitCafeActionPayloadSchema } = await import("./gitcafe-action.ts");
		const payload = { reason: undefined, extra: [null, { keep: true }] };
		const parsed = gitCafeActionPayloadSchema.parse(payload);
		expect(parsed.reason).toBeUndefined();
		expect(Object.hasOwn(parsed, "reason")).toBe(true);
		expect(parsed.extra).toEqual([null, { keep: true }]);
		expect(
			gitCafeActionPayloadSchema.safeParse({ extra: new Date() }).success,
		).toBe(false);
		expect(
			gitCafeActionPayloadSchema.safeParse({ extra: () => "not JSON" }).success,
		).toBe(false);
	});
});

test("stored action records and delivery bodies preserve original own __proto__ JSON", async () => {
	const { storedActionPayloadSchema, deliveryActionPayloadSchema } =
		await import("./action-words.ts");
	const extra = JSON.parse(
		'{"__proto__":{"keep":true},"nested":{"__proto__":null}}',
	);
	expect(storedActionPayloadSchema.parse(extra)).toBe(extra);
	const delivery = {
		version: 1,
		verdict: "block",
		org: "test",
		repo: "test/repo",
		changeRequest: { number: 1, title: "test", author: "test", ...extra },
		firedRules: [],
		runUrl: "https://tripwire.sh/runs/test",
		timestamp: "2026-07-12T00:00:00.000Z",
		...extra,
	};
	const parsed = deliveryActionPayloadSchema.parse({
		url: "https://hook.example/x",
		delivery,
	});
	expect(parsed.delivery).toBe(delivery);
	expect(JSON.stringify(parsed.delivery)).toBe(JSON.stringify(delivery));
});

test("deep valid extras remain stack-safe through record and delivery owners", async () => {
	const { storedActionPayloadSchema, deliveryActionPayloadSchema } =
		await import("./action-words.ts");
	let deep: ReturnType<typeof storedActionPayloadSchema.parse> | null = null;
	for (let index = 0; index < 8000; index++) deep = { nested: deep };
	const record = { extra: deep };
	expect(storedActionPayloadSchema.parse(record)).toBe(record);
	const delivery = {
		version: 1,
		verdict: "block",
		org: "test",
		repo: "test/repo",
		changeRequest: { number: 1, title: "test", author: "test" },
		firedRules: [],
		runUrl: "https://tripwire.sh/runs/test",
		timestamp: "2026-07-12T00:00:00.000Z",
		...record,
	} satisfies WebhookPayload;
	expect(
		deliveryActionPayloadSchema.parse({
			url: "https://hook.example/x",
			delivery,
		}).delivery,
	).toBe(delivery);
});
