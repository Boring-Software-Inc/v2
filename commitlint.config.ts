import type { UserConfig } from "@commitlint/types";

/**
 * Conventional commits, adapted to two things this repo already does.
 *
 * 1. Commits carry a task id FIRST: `TRP-83 feat(economics): …`. The stock
 *    conventional parser reads that prefix as the type and rejects the commit,
 *    so `headerPattern` below makes an optional `ABC-123 ` prefix part of the
 *    grammar.
 * 2. `design:` is a real type here (see `git log`), so it joins the enum
 *    alongside the standard set.
 *
 * Flip [[REQUIRE_TICKET]] to make the task id mandatory. It is off because
 * `chore: bump deps` is a legitimate commit with no task behind it.
 */
const REQUIRE_TICKET = false;

/** `TRP-83`, `MDN-42` — uppercase project key, dash, digits. */
const TICKET = /^[A-Z][A-Z0-9]*-\d+$/;

const config: UserConfig = {
	extends: ["@commitlint/config-conventional"],
	parserPreset: {
		parserOpts: {
			// `TRP-83 feat(scope)!: subject` — ticket and scope both optional.
			headerPattern:
				/^(?:([A-Z][A-Z0-9]*-\d+)\s+)?([a-z]+)(?:\(([^)]+)\))?(!?): (.+)$/,
			headerCorrespondence: ["ticket", "type", "scope", "breaking", "subject"],
		},
	},
	plugins: [
		{
			rules: {
				"ticket-required": (parsed: { ticket?: string | null }) => [
					!REQUIRE_TICKET ||
						(typeof parsed.ticket === "string" && TICKET.test(parsed.ticket)),
					"commit must start with a task id, e.g. `TRP-83 feat(ui): …`",
				],
			},
		},
	],
	rules: {
		"type-enum": [
			2,
			"always",
			[
				"build",
				"chore",
				"ci",
				"design",
				"docs",
				"feat",
				"fix",
				"perf",
				"refactor",
				"revert",
				"style",
				"test",
			],
		],
		// The ticket prefix eats into the header budget; 100 is the stock cap.
		"header-max-length": [2, "always", 100],
		"ticket-required": [2, "always"],
	},
};

export default config;
