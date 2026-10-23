import type { Agent, McpChange } from "#/agents";
import type { MergeOutcome } from "#/json-config";
import { skillPath, writeSkill } from "#/skill";

export interface Detection {
	agent: Agent;
	installed: boolean;
}

export interface SkillChange {
	path: string;
	outcome: MergeOutcome;
}

export type InstallResult =
	| { kind: "done"; mcp: McpChange; skills: SkillChange[] }
	| { kind: "failed"; message: string };

export async function detectAgents(agents: Agent[]): Promise<Detection[]> {
	const found = agents.filter((agent) => agent.detect());
	return Promise.all(
		found.map(async (agent) => ({
			agent,
			installed: await agent.hasServer().catch(() => false),
		})),
	);
}

export async function installAgent(
	agent: Agent,
	url: string,
	written: Map<string, MergeOutcome> = new Map(),
): Promise<InstallResult> {
	try {
		const mcp = await agent.addServer(url);
		const skills = agent.skillsDirs().map((dir) => {
			const outcome = written.get(dir) ?? writeSkill(dir);
			written.set(dir, outcome);
			return { path: skillPath(dir), outcome };
		});
		return { kind: "done", mcp, skills };
	} catch (error) {
		return {
			kind: "failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
