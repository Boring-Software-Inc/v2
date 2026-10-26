import { join } from "node:path";
import { addWithCli, configuredUrl, sharedSkillsDir } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import type { System } from "#/system";

function settingsPath(system: System): string {
	return join(
		system.env.GEMINI_CLI_HOME || system.home,
		".gemini",
		"settings.json",
	);
}

function currentUrl(system: System): string | null {
	return configuredUrl(settingsPath(system), "mcpServers", SERVER_NAME, [
		"httpUrl",
		"url",
	]);
}

export function createGemini(system: System): Agent {
	return {
		id: "gemini",
		name: "Gemini CLI",
		signInHint: `/mcp auth ${SERVER_NAME} inside Gemini CLI`,
		detect: () => system.which("gemini") !== null,
		hasServer: async () => currentUrl(system) !== null,
		addServer: (url) =>
			addWithCli(system, {
				binary: system.which("gemini") ?? "gemini",
				display: "gemini",
				addArgs: [
					"mcp",
					"add",
					"--transport",
					"http",
					"--scope",
					"user",
					SERVER_NAME,
					url,
				],
				removeArgs: ["mcp", "remove", "--scope", "user", SERVER_NAME],
				current: currentUrl(system),
				url,
			}),
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => null,
	};
}
