import { createAmp } from "#/agents/amp";
import { createAntigravity } from "#/agents/antigravity";
import { createClaude } from "#/agents/claude";
import { createCline } from "#/agents/cline";
import { createCodex } from "#/agents/codex";
import { createCopilot } from "#/agents/copilot";
import { createCursor } from "#/agents/cursor";
import { createDevin } from "#/agents/devin";
import { createDroid } from "#/agents/droid";
import { createGemini } from "#/agents/gemini";
import { createGoose } from "#/agents/goose";
import { createGrok } from "#/agents/grok";
import { createKiro } from "#/agents/kiro";
import { createMuse } from "#/agents/muse";
import { createKilo, createOpencode } from "#/agents/opencode";
import type { Agent } from "#/agents/types";
import { createVscode } from "#/agents/vscode";
import { createZed } from "#/agents/zed";
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
		createOpencode(system),
		createGemini(system),
		createAntigravity(system),
		createCopilot(system),
		createAmp(system),
		createDroid(system),
		createCline(system),
		createKilo(system),
		createKiro(system),
		createZed(system),
		createGoose(system),
		createMuse(system),
	];
}
