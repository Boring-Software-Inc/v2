import { join } from "node:path";
import { addWithCli, configuredUrl, sharedSkillsDir } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import type { System } from "#/system";

function configPath(system: System): string {
	return join(
		system.env.COPILOT_HOME || join(system.home, ".copilot"),
		"mcp-config.json",
	);
}

function currentUrl(system: System): string | null {
	return configuredUrl(configPath(system), "mcpServers", SERVER_NAME);
}

export function createCopilot(system: System): Agent {
	return {
		id: "copilot",
		name: "GitHub Copilot CLI",
		signInHint: `/mcp auth ${SERVER_NAME} inside Copilot CLI`,
		detect: () => system.which("copilot") !== null,
		hasServer: async () => currentUrl(system) !== null,
		addServer: (url) =>
			addWithCli(system, {
				binary: system.which("copilot") ?? "copilot",
				display: "copilot",
				addArgs: ["mcp", "add", "--transport", "http", SERVER_NAME, url],
				removeArgs: ["mcp", "remove", SERVER_NAME],
				current: currentUrl(system),
				url,
			}),
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => null,
	};
}
