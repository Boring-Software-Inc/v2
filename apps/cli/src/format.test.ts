import { describe, expect, test } from "bun:test";
import {
	errorLine,
	formatResult,
	formatUserCode,
	friendlyError,
	pairs,
} from "#/format";

describe("friendlyError", () => {
	test("maps a missing argument to one line", () => {
		expect(
			friendlyError(
				"MCP error -32602: Input validation error: Invalid arguments for tool list_runs: Invalid input: expected string, received undefined at repo",
			),
		).toBe("Missing argument: repo.");
	});

	test("lists several missing arguments", () => {
		expect(
			friendlyError(
				"MCP error -32602: Input validation error: Invalid arguments for tool set_rule: Invalid input: expected string, received undefined at repo\nInvalid input: expected boolean, received undefined at enabled",
			),
		).toBe("Missing arguments: repo, enabled.");
	});

	test("names an invalid argument", () => {
		expect(
			friendlyError(
				"MCP error -32602: Input validation error: Invalid arguments for tool list_runs: Too big: expected number to be <=50 at limit",
			),
		).toBe("limit must be 50 or less.");
		expect(
			friendlyError(
				'MCP error -32602: Input validation error: Invalid arguments for tool list_runs: Too small: expected number to be >=1 at limit\nInvalid option: expected one of "approve"|"deny" at decision',
			),
		).toBe("limit must be 1 or more. decision must be one of approve, deny.");
	});

	test("maps the server hint to a CLI command", () => {
		expect(
			friendlyError("No repo named scratch in grim. Call list_repos.", {
				error: "No repo named scratch in grim.",
				hint: "list_repos",
			}),
		).toBe("No repo named scratch in grim. Run tripwire repos to see them.");
		expect(
			friendlyError("x", {
				error: "You can reach more than one org.",
				hint: "pick_org",
			}),
		).toBe(
			"You can reach more than one org. Pass --org <slug>, or run tripwire whoami to see them.",
		);
	});

	test("drops tool names from an older server message", () => {
		expect(
			friendlyError(
				"No repo named scratch in grim. Call list_repos to see the repos.",
			),
		).toBe("No repo named scratch in grim.");
	});

	test("never shows the raw MCP error prefix", () => {
		expect(friendlyError("MCP error -32602: Tool nope not found")).not.toMatch(
			/MCP error|-32602/,
		);
	});
});

describe("plain text output", () => {
	test("pairs align values after a 10 character label column", () => {
		expect(
			pairs([
				["code", "YRU2-LV9K"],
				["open", "https://app.tripwire.sh/device"],
				["", "Waiting"],
			]),
		).toBe(
			"code      YRU2-LV9K\nopen      https://app.tripwire.sh/device\n          Waiting",
		);
		expect(errorLine("Nope.")).toBe("error     Nope.");
	});

	test("device codes show as XXXX-XXXX", () => {
		expect(formatUserCode("yru2lv9k")).toBe("YRU2-LV9K");
		expect(formatUserCode("YRU2-LV9K")).toBe("YRU2-LV9K");
	});

	test("rules list for a repo", () => {
		expect(
			formatResult("get_repo_rules", [
				{
					ruleId: "account-age@1",
					enabled: true,
					management: "direct",
					cannotRun: null,
					matches24h: 3,
				},
				{
					ruleId: "first-pr@1",
					enabled: false,
					management: "managed",
					cannotRun: null,
					matches24h: 0,
				},
			]),
		).toBe(
			[
				"RULE                          STATE     MATCHES 24H     NOTE",
				"account-age@1                 on        3",
				"first-pr@1                    off       0               set by a workflow",
			].join("\n"),
		);
	});

	test("workflows list", () => {
		expect(
			formatResult("list_workflows", [
				{
					id: "wf_1",
					name: "Default gate",
					enabled: true,
					nodeCount: 4,
					triggerKinds: ["change_request.opened"],
					updatedAt: "2026-10-22T00:00:00.000Z",
					url: "https://app.tripwire.sh/grim/scratch/workflows/wf_1",
				},
			]),
		).toBe(
			[
				"WORKFLOW                      ID       STATE     TRIGGERS",
				"Default gate                  wf_1     on        change_request.opened",
			].join("\n"),
		);
	});

	test("run show", () => {
		expect(
			formatResult("get_run", {
				note: "untrusted",
				id: "run_1",
				repo: "grim/scratch",
				number: 12,
				status: "completed",
				verdict: "block",
				createdAt: "2026-10-22T14:03:00.000Z",
				steps: [
					{
						kind: "rule",
						rule: "account-age@1",
						status: "fail",
						summary: "Account is 2 days old",
						workflow: "Newcomers",
						stepId: "age",
						step: "Account age",
						gate: null,
						outcome: "Doesn't pass",
					},
					{
						kind: "gate",
						rule: null,
						status: "pass",
						summary: null,
						workflow: "Newcomers",
						stepId: "either",
						step: "Any of",
						gate: "any of",
						outcome: "Passes",
					},
				],
				actions: [],
				url: "https://app.tripwire.sh/runs/run_1",
			}),
		).toBe(
			[
				"run       run_1",
				"repo      grim/scratch #12",
				"status    completed",
				"verdict   block",
				"created   2026-10-22 14:03 UTC",
				"open      https://app.tripwire.sh/runs/run_1",
				"",
				"WORKFLOW      STEP                  OUTCOME          SUMMARY",
				"Newcomers     Account age (age)     Doesn't pass     Account is 2 days old",
				"Newcomers     Any of (either)       Passes",
			].join("\n"),
		);
	});

	test("queue list", () => {
		expect(
			formatResult("list_moderation_queue", {
				note: "untrusted",
				items: [
					{
						itemId: "mi_1",
						runId: "run_1",
						repo: "grim/scratch",
						number: 7,
						actor: "newbie",
						title: "Fix typo",
						reason: null,
						createdAt: "2026-10-22T14:03:00.000Z",
					},
				],
			}),
		).toBe(
			[
				"ITEM                          REPO        PR     AUTHOR     TITLE",
				"mi_1                          scratch     #7     newbie     Fix typo",
			].join("\n"),
		);
		expect(formatResult("list_moderation_queue", { items: [] })).toBe(
			"Nothing to review.",
		);
	});

	test("status for a member who cannot install", () => {
		expect(
			formatResult("setup_status", {
				org: "grim",
				role: "member",
				nextStep: "install_app",
			}),
		).toBe(
			"org       grim\nnext      Ask an admin of grim to install the GitHub App",
		);
	});
});
