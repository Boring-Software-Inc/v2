import { formatCommand, sharedSkillsDir } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import type { System } from "#/system";

export function createGrok(system: System): Agent {
	const binary = () => system.which("grok") ?? "grok";
	const addArgs = (url: string) => [
		"mcp",
		"add",
		"--transport",
		"http",
		SERVER_NAME,
		url,
	];
	const listed = async () => {
		const result = await system.run(binary(), ["mcp", "list"]);
		return (
			result.ok &&
			new RegExp(`(^|[^\\w.-])${SERVER_NAME}(?=$|[^\\w.-])`).test(result.stdout)
		);
	};
	return {
		id: "grok",
		name: "Grok",
		signInHint: "/mcps inside Grok",
		detect: () => system.which("grok") !== null,
		hasServer: listed,
		addServer: async (url) => {
			const command = formatCommand("grok", addArgs(url));
			if (await listed()) {
				return { target: command, outcome: "unchanged" };
			}
			const result = await system.run(binary(), addArgs(url));
			if (result.ok) {
				return { target: command, outcome: "added" };
			}
			if (/already exists/i.test(`${result.stderr} ${result.stdout}`)) {
				return { target: command, outcome: "unchanged" };
			}
			throw new Error(result.stderr || result.stdout || `${command} failed`);
		},
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => null,
	};
}
