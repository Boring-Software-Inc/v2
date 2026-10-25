import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	normalizedEventSchema,
	type RepoScopedEvent,
} from "@tripwire/contracts";
import type { PreviewChangeRequest, PreviewInputs } from "@tripwire/db";
import { computeRulePreview, outsideContributors } from "./rule-preview.ts";

const NOW = new Date("2026-07-12T00:00:00.000Z");

async function baseEvent(): Promise<RepoScopedEvent> {
	const parsed = normalizedEventSchema.parse(
		await Bun.file(
			fileURLToPath(
				new URL(
					"../../../../packages/core/fixtures/change-request.opened.event.json",
					import.meta.url,
				),
			),
		).json(),
	);
	if (!("changeRequest" in parsed)) {
		throw new Error("fixture is not a change request");
	}
	return parsed;
}

async function changeRequest(
	number: number,
	title: string,
	authorAssociation: string | null = "NONE",
): Promise<PreviewChangeRequest> {
	const event = await baseEvent();
	if (!("changeRequest" in event)) {
		throw new Error("fixture is not a change request");
	}
	return {
		number,
		title,
		author: `user-${number}`,
		authorAssociation,
		event: {
			...event,
			changeRequest: { ...event.changeRequest, number, title },
		},
	};
}

function ruleOf(
	preview: Awaited<ReturnType<typeof computeRulePreview>>,
	id: string,
) {
	return preview.rules.find((rule) => rule.ruleId === id);
}

describe("computeRulePreview", () => {
	test("english only is evaluated from the stored title alone", async () => {
		const inputs: PreviewInputs = {
			changeRequests: [
				await changeRequest(3, "Обновить документацию проекта"),
				await changeRequest(2, "Fix the README links"),
			],
			steps: [],
		};
		const preview = await computeRulePreview(inputs, "github", NOW);
		expect(preview.changeRequests).toBe(2);
		const english = ruleOf(preview, "english-only");
		expect(english?.caught).toEqual([3]);
		expect(english?.examples[0]).toMatchObject({
			number: 3,
			author: "user-3",
			reason: "Title 100% non-latin",
		});
	});

	test("lists every change request it evaluated, newest first", async () => {
		const preview = await computeRulePreview(
			{
				changeRequests: [
					await changeRequest(9, "Add airdrop section"),
					await changeRequest(7, "Fix the README links"),
				],
				steps: [],
			},
			"github",
			NOW,
		);
		expect(preview.recent).toEqual([
			{ number: 9, title: "Add airdrop section", author: "user-9" },
			{ number: 7, title: "Fix the README links", author: "user-7" },
		]);
	});

	test("a rule that needs a live read has no count without stored runs", async () => {
		const preview = await computeRulePreview(
			{ changeRequests: [await changeRequest(2, "Fix typo")], steps: [] },
			"github",
			NOW,
		);
		expect(ruleOf(preview, "account-age")?.caught).toBeNull();
		expect(ruleOf(preview, "honeypot")?.caught).toBeNull();
		expect(ruleOf(preview, "crypto-address")?.caught).toBeNull();
	});

	test("stored evaluations at the default settings count", async () => {
		const preview = await computeRulePreview(
			{
				changeRequests: [
					await changeRequest(5, "Add donation link"),
					await changeRequest(4, "Bump deps"),
				],
				steps: [
					{
						number: 5,
						ref: "account-age@1",
						config: { minDays: 7 },
						status: "pass",
						evidence: null,
					},
					{
						number: 5,
						ref: "account-age@1",
						config: { minDays: 7 },
						status: "fail",
						evidence: { accountAgeDays: 1, minDays: 7 },
					},
					{
						number: 4,
						ref: "account-age@1",
						config: { minDays: 7 },
						status: "pass",
						evidence: null,
					},
				],
			},
			"github",
			NOW,
		);
		const age = ruleOf(preview, "account-age");
		expect(age?.caught).toEqual([5]);
		expect(age?.examples[0]?.reason).toBe("Account 1 day old");
	});

	test("an evaluation at other settings, or a skip, is not evidence", async () => {
		const preview = await computeRulePreview(
			{
				changeRequests: [
					await changeRequest(5, "Add donation link"),
					await changeRequest(4, "Bump deps"),
				],
				steps: [
					{
						number: 5,
						ref: "account-age@1",
						config: { minDays: 30 },
						status: "fail",
						evidence: null,
					},
					{
						number: 4,
						ref: "account-age@1",
						config: { minDays: 7 },
						status: "skipped",
						evidence: null,
					},
				],
			},
			"github",
			NOW,
		);
		expect(ruleOf(preview, "account-age")?.caught).toBeNull();
	});

	test("rules the forge cannot run get no count", async () => {
		const preview = await computeRulePreview(
			{ changeRequests: [], steps: [] },
			"opengit",
			NOW,
		);
		expect(ruleOf(preview, "account-age")?.caught).toBeNull();
		expect(ruleOf(preview, "english-only")?.caught).toEqual([]);
	});

	test("maintainers and members are left out", async () => {
		const inputs = outsideContributors({
			changeRequests: [
				await changeRequest(3, "a", "OWNER"),
				await changeRequest(2, "b", "MEMBER"),
				await changeRequest(1, "c", "FIRST_TIME_CONTRIBUTOR"),
				await changeRequest(0, "d", null),
			],
			steps: [],
		});
		expect(inputs.changeRequests.map((cr) => cr.number)).toEqual([1, 0]);
	});
});
