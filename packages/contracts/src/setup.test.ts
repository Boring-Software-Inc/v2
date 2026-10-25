import { describe, expect, test } from "bun:test";
import {
	parseSetupCommandArg,
	setupProgressInputSchema,
	setupPrompt,
	setupRunPrompt,
} from "./setup.ts";

describe("setup prompt", () => {
	test("with a run code it names the org, the code and both paths", () => {
		expect(setupPrompt({ org: "acme", code: "AbCdE12345" })).toBe(
			"Please help me set up Tripwire.\n\norg slug: acme\nrun code: AbCdE12345\n\nIf you can run commands, run npx @tripwire-sh/cli install acme#AbCdE12345, or bunx @tripwire-sh/cli install acme#AbCdE12345 when npx stops with EBADDEVENGINES. If not, add the MCP server https://mcp.tripwire.sh/mcp and use its tools.",
		);
	});

	test("without a code it drops the org, the code and the argument", () => {
		expect(setupPrompt()).toBe(
			"Please help me set up Tripwire.\n\nIf you can run commands, run npx @tripwire-sh/cli install, or bunx @tripwire-sh/cli install when npx stops with EBADDEVENGINES. If not, add the MCP server https://mcp.tripwire.sh/mcp and use its tools.",
		);
	});
});

describe("setup run prompt", () => {
	test("names the org and the code, with no install step", () => {
		expect(setupRunPrompt({ org: "acme", code: "AbCdE12345" })).toBe(
			"Please help me set up Tripwire.\n\norg slug: acme\nrun code: AbCdE12345",
		);
		expect(setupRunPrompt()).toBe("Please help me set up Tripwire.");
	});
});

describe("setup command argument", () => {
	test("parses org#code", () => {
		expect(parseSetupCommandArg("acme-co#AbCdE12345")).toEqual({
			org: "acme-co",
			code: "AbCdE12345",
		});
	});

	test("rejects a short code or an uppercase org", () => {
		expect(parseSetupCommandArg("acme#short")).toBeNull();
		expect(parseSetupCommandArg("Acme#AbCdE12345")).toBeNull();
	});
});

describe("progress input", () => {
	test("accepts the documented shape and refuses unknown stages", () => {
		expect(
			setupProgressInputSchema.safeParse({
				runCode: "AbCdE12345",
				stage: "install_app",
				status: "waiting",
			}).success,
		).toBe(true);
		expect(
			setupProgressInputSchema.safeParse({
				runCode: "AbCdE12345",
				stage: "analyze_project",
				status: "active",
			}).success,
		).toBe(false);
	});
});

describe("setup progress repo", () => {
	test("takes an owner/name repo", () => {
		const parsed = setupProgressInputSchema.parse({
			runCode: "AbCdE12345",
			stage: "verify_check",
			status: "active",
			repo: "lumenhq/lumen",
		});
		expect(parsed.repo).toBe("lumenhq/lumen");
	});

	test("refuses a repo that is not owner/name", () => {
		for (const repo of ["lumen", "a/b/c", "https://github.com/a/b"]) {
			expect(
				setupProgressInputSchema.safeParse({
					runCode: "AbCdE12345",
					stage: "verify_check",
					status: "active",
					repo,
				}).success,
			).toBe(false);
		}
	});
});
