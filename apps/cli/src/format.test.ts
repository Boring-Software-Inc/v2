import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	decisionChoiceError,
	errorLine,
	formatResult,
	formatUserCode,
	friendlyError,
	pairs,
	styleFor,
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
				"Default gate                  wf_1     live      change_request.opened",
			].join("\n"),
		);
	});

	test("workflows list says when a live workflow cannot run, like the web", () => {
		const rows = formatResult("list_workflows", [
			{
				id: "wf_1",
				name: "Crypto",
				enabled: true,
				runnable: false,
				canTurnOn: false,
			},
			{
				id: "wf_2",
				name: "bad-allof-trigger",
				enabled: false,
				runnable: false,
				canTurnOn: false,
			},
			{
				id: "wf_3",
				name: "Fine",
				enabled: false,
				runnable: true,
				canTurnOn: true,
			},
		]);
		expect(rows).toContain("wf_1     can't run");
		expect(rows).toContain("wf_2     can't turn on");
		expect(rows).toContain("wf_3     off");
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
				"verdict   Blocked",
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

describe("run steps and decisions in product words", () => {
	test("a workflow that could not run is named in runs show", () => {
		const text = formatResult("get_run", {
			id: "run_2",
			repo: "grim/scratch",
			number: 140,
			status: "paused",
			verdict: "needs_review",
			createdAt: "2026-10-23T14:15:00.000Z",
			steps: [
				{
					kind: "gate",
					rule: null,
					status: "skipped",
					summary: "All of: It takes rule results, not events",
					workflow: "QA any of crypto or honeypot blocks",
					stepId: null,
					step: "Its wiring is broken, so Tripwire did not run it",
					gate: null,
					outcome: "Could not run",
				},
			],
		});
		expect(text).toContain("verdict   Waiting for human review");
		expect(text).toContain(
			"QA any of crypto or honeypot blocks     Its wiring is broken, so Tripwire did not run it     Could not run",
		);
		expect(text).not.toContain("run:unrunnable");
		expect(text).not.toContain("\n-  ");
	});

	test("a run closed before review says so, and a comment run says Ran", () => {
		const closed = formatResult("get_run", {
			id: "run_3",
			repo: "grim/scratch",
			number: 144,
			status: "closed",
			verdict: "needs_review",
			result: "closed-before-review",
			verdictLabel: "Closed before review",
			createdAt: "2026-10-23T14:15:00.000Z",
			steps: [],
		});
		expect(closed).toContain("status    closed");
		expect(closed).toContain("verdict   Closed before review");
		expect(closed).not.toContain("Waiting");
		const comment = formatResult("get_run", {
			id: "run_4",
			repo: "grim/scratch",
			number: 142,
			status: "completed",
			verdict: "pass",
			result: "ran",
			verdictLabel: "Ran",
			createdAt: "2026-10-23T14:15:00.000Z",
			steps: [],
		});
		expect(comment).toContain("verdict   Ran");
		expect(
			formatResult("list_runs", [
				{
					id: "run_3",
					repo: "grim/scratch",
					number: 144,
					status: "closed",
					verdict: "needs_review",
					result: "closed-before-review",
					verdictLabel: "Closed before review",
					createdAt: "2026-10-23T14:15:00.000Z",
				},
			]),
		).toContain("Closed before review");
	});

	test("a decided review reads its decision once, and the floor names its workflow", () => {
		const text = formatResult("get_run", {
			id: "run_5",
			repo: "grim/scratch",
			number: 146,
			status: "completed",
			verdict: "block",
			result: "block",
			verdictLabel: "Blocked",
			createdAt: "2026-10-23T14:15:00.000Z",
			steps: [
				{
					kind: "action",
					rule: null,
					status: "pass",
					summary: null,
					workflow: "Doubtful title",
					stepId: "send-to-moderation",
					step: "Human review",
					gate: null,
					outcome: "Blocked",
				},
				{
					kind: "action",
					rule: null,
					status: "pass",
					summary: null,
					workflow: "Doubtful title",
					stepId: null,
					step: "Human review blocked it",
					gate: null,
					outcome: "Blocked",
				},
			],
		});
		expect(text).toContain(
			"Doubtful title     Human review (send-to-moderation)     Blocked",
		);
		expect(text).toContain("Doubtful title     Human review blocked it");
		expect(text).not.toContain("run:deny-floor");
		expect(text).not.toContain("\n-  ");
	});

	test("a decision names the decision and the change request", () => {
		expect(
			formatResult("decide_moderation", {
				done: true,
				decision: "remove",
				itemId: "i1",
				repo: "grim/scratch",
				number: 139,
			}),
		).toBe("done      Blocked #139 on grim/scratch");
		expect(
			formatResult("decide_moderation", {
				done: false,
				alreadyDecided: true,
				decision: "approve",
				itemId: "i1",
				repo: "grim/scratch",
				number: 139,
			}),
		).toBe("done      #139 on grim/scratch was already decided");
	});

	test("an unknown decision lists the choices", () => {
		expect(decisionChoiceError("deny")).toBe(
			"deny is not a choice. Use approve to let the change request through, remove to block it, or ban to get a link where a person bans the contributor.",
		);
	});
});

describe("tables with colored cells", () => {
	const color = styleFor(true, {});
	const visible = stripVTControlCharacters;
	const columnsOf = (output: string) =>
		visible(output)
			.split("\n")
			.map((line) => [...line.matchAll(/\S+(?: \S+)*/g)].map((m) => m.index));

	test("repos values sit under their headers when the gate is colored", () => {
		const output =
			formatResult(
				"list_repos",
				[
					{ name: "scratch", gateOn: true, toReview: 3, blocked24h: 24 },
					{ name: "website", gateOn: false, toReview: 0, blocked24h: 1 },
				],
				color,
			) ?? "";
		expect(output).toContain("\x1b[");
		expect(visible(output)).toBe(
			[
				"REPO                          GATE     TO REVIEW     BLOCKED 24H",
				"scratch                       on       3             24",
				"website                       off      0             1",
			].join("\n"),
		);
	});

	test("every colored table keeps its columns in line", () => {
		const outputs = [
			formatResult(
				"get_repo_rules",
				[
					{ ruleId: "account-age@1", enabled: true, matches24h: 2 },
					{ ruleId: "rate-limit@1", enabled: false, matches24h: 0 },
				],
				color,
			),
			formatResult(
				"list_workflows",
				[
					{ id: "wf_1", name: "Gate", enabled: true, triggerKinds: ["pr"] },
					{ id: "wf_2", name: "Stale", enabled: false, triggerKinds: ["cron"] },
				],
				color,
			),
			formatResult(
				"list_runs",
				[
					{
						id: "run_1",
						repo: "o/scratch",
						number: 4,
						status: "done",
						verdict: "pass",
						result: "pass",
						verdictLabel: "Passed",
						createdAt: "2026-10-23T10:00:00Z",
					},
					{
						id: "run_2",
						repo: "o/scratch",
						number: 5,
						status: "done",
						verdict: "block",
						result: "block",
						verdictLabel: "Blocked",
						createdAt: "2026-10-23T11:00:00Z",
					},
				],
				color,
			),
		];
		for (const output of outputs) {
			expect(output ?? "").toContain("\x1b[");
			const [header, ...rows] = columnsOf(output ?? "");
			for (const row of rows) {
				expect(row.length).toBeGreaterThan(2);
				expect(row).toEqual((header ?? []).slice(0, row.length));
			}
		}
	});
});
