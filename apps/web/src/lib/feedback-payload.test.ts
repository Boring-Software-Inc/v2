import { describe, expect, test } from "bun:test";
import { buildFeedbackEmbed, feedbackInputSchema } from "./feedback-payload";

const now = new Date("2026-10-25T12:00:00Z");

const base = {
	comment: "This flags our own docs changes.",
	route: "/lumenhq/lumen/rules",
	userAgent: "Mozilla/5.0",
	metadata: { user: "grim" },
};

describe("feedbackInputSchema", () => {
	test("accepts a picked element", () => {
		const parsed = feedbackInputSchema.parse({
			...base,
			element: {
				name: "RuleCard",
				trail: ["RuleCard"],
				path: 'div[data-feedback-name="RuleCard"]',
				text: "Crypto address",
			},
			screenshotDataUrl: "data:image/png;base64,AAAA",
		});
		expect(parsed.element?.name).toBe("RuleCard");
	});

	test("rejects an empty comment and a non-png screenshot", () => {
		expect(
			feedbackInputSchema.safeParse({ ...base, comment: "  " }).success,
		).toBe(false);
		expect(
			feedbackInputSchema.safeParse({
				...base,
				screenshotDataUrl: "data:text/html;base64,AAAA",
			}).success,
		).toBe(false);
	});
});

describe("buildFeedbackEmbed", () => {
	test("names the element, its path and its text", () => {
		const embed = buildFeedbackEmbed(
			{
				...base,
				element: {
					name: "RuleCard",
					trail: ["RulesList", "RuleCard"],
					path: 'main#main-content > div[data-feedback-name="RuleCard"]',
					text: "Crypto address",
				},
			},
			true,
			now,
		);
		expect(embed.title).toBe("Feedback: RuleCard");
		expect(embed.description).toBe(base.comment);
		expect(embed.image).toEqual({ url: "attachment://screenshot.png" });
		expect(embed.fields.map((f) => [f.name, f.value])).toEqual([
			["Route", "/lumenhq/lumen/rules"],
			["Element", "`RuleCard`"],
			["Inside", "`RulesList > RuleCard`"],
			["DOM path", '`main#main-content > div[data-feedback-name="RuleCard"]`'],
			["Text", "Crypto address"],
			["user", "grim"],
			["Screenshot", "Attached"],
		]);
		expect(embed.timestamp).toBe(now.toISOString());
	});

	test("skipped picks keep today's shape", () => {
		const embed = buildFeedbackEmbed({ ...base, element: null }, false, now);
		expect(embed.title).toBe("New User Feedback");
		expect(embed.image).toBeUndefined();
		expect(embed.fields.map((f) => f.name)).toEqual([
			"Route",
			"user",
			"Screenshot",
		]);
	});

	test("stays under Discord's embed ceiling", () => {
		const embed = buildFeedbackEmbed(
			{
				...base,
				comment: "x".repeat(4000),
				metadata: Object.fromEntries(
					Array.from({ length: 30 }, (_, i) => [`k${i}`, "v".repeat(200)]),
				),
			},
			false,
			now,
		);
		const total =
			embed.title.length +
			embed.description.length +
			embed.footer.text.length +
			embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
		expect(total).toBeLessThanOrEqual(6000);
		expect(embed.fields.length).toBeLessThanOrEqual(25);
	});
});
