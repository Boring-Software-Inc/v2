import { createClaude } from "#/agents/claude";
import { createCodex } from "#/agents/codex";
import { createCursor } from "#/agents/cursor";
import { createDevin } from "#/agents/devin";
import { createGrok } from "#/agents/grok";
import type { Agent } from "#/agents/types";
import { createVscode } from "#/agents/vscode";
import type { System } from "#/system";

export type { Agent, LoginCommand, McpChange } from "#/agents/types";

export function buildAgents(system: System): Agent[] {
	return [
		createClaude(system),
		createCodex(system),
		createCursor(system),
		createVscode(system),
		createDevin(system),
		createGrok(system),
	];
}
