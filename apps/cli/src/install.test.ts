import { describe, expect, test } from "bun:test";
import { installSelectionError } from "#/install";

describe("install selection", () => {
	test("non-interactive execution never widens an empty selection", () => {
		expect(
			installSelectionError(
				{ agentIds: [], all: false, yes: false, interactive: false },
				["codex", "claude"],
			),
		).toBe(
			"Non-interactive installation requires --agent <id> or --all --yes.",
		);
	});

	test("yes confirms all but does not select it", () => {
		expect(
			installSelectionError(
				{ agentIds: [], all: false, yes: true, interactive: false },
				["codex"],
			),
		).not.toBeNull();
		expect(
			installSelectionError(
				{ agentIds: [], all: true, yes: true, interactive: false },
				["codex"],
			),
		).toBeNull();
	});

	test("explicit agents do not select every detection", () => {
		expect(
			installSelectionError(
				{ agentIds: ["codex"], all: false, yes: false, interactive: false },
				["codex", "claude"],
			),
		).toBeNull();
	});

	test("all requires confirmation and conflicts with agent ids", () => {
		expect(
			installSelectionError(
				{ agentIds: [], all: true, yes: false, interactive: false },
				["codex"],
			),
		).toBe("--all requires --yes.");
		expect(
			installSelectionError(
				{ agentIds: ["codex"], all: true, yes: true, interactive: false },
				["codex"],
			),
		).toBe("Use --agent or --all, not both.");
	});
});
