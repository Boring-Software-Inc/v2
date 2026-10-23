import { describe, expect, test } from "bun:test";
import { buildPrompt, DEFAULT_PROMPT } from "#/prompt";

describe("buildPrompt", () => {
	test("org#code builds the setup prompt", () => {
		expect(buildPrompt("acme#abcde12345")).toBe(
			"Please help me set up Tripwire.\n\norg slug: acme\nrun code: abcde12345",
		);
	});

	test("accepts underscores, dashes and digits in the slug", () => {
		expect(buildPrompt("  my_org-2#A1b2C3d4E5 ")).toContain(
			"org slug: my_org-2\nrun code: A1b2C3d4E5",
		);
	});

	test("a code that is not 10 alphanumerics is free text", () => {
		expect(buildPrompt("acme#abc")).toBe(
			"Tripwire was just installed. acme#abc",
		);
		expect(buildPrompt("Acme#abcde12345")).toBe(
			"Tripwire was just installed. Acme#abcde12345",
		);
	});

	test("free text gets the installed prefix", () => {
		expect(buildPrompt("Turn on the gate for web")).toBe(
			"Tripwire was just installed. Turn on the gate for web",
		);
	});

	test("no argument uses the skill prompt", () => {
		expect(buildPrompt()).toBe(DEFAULT_PROMPT);
		expect(buildPrompt("   ")).toBe(DEFAULT_PROMPT);
		expect(DEFAULT_PROMPT).toBe(
			"Use the `tripwire-get-started` skill for this project.",
		);
	});
});
