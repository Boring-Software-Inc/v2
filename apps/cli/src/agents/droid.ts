import { join } from "node:path";
import { addWithCli, configuredUrl, sharedSkillsDir } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import type { System } from "#/system";

function currentUrl(system: System): string | null {
	return configuredUrl(
		join(system.home, ".factory", "mcp.json"),
		"mcpServers",
		SERVER_NAME,
	);
}

export function createDroid(system: System): Agent {
	return {
		id: "droid",
		name: "Factory Droid",
		signInHint: "/mcp inside Droid",
		detect: () => system.which("droid") !== null,
		hasServer: async () => currentUrl(system) !== null,
		addServer: (url) =>
			addWithCli(system, {
				binary: system.which("droid") ?? "droid",
				display: "droid",
				addArgs: ["mcp", "add", SERVER_NAME, url, "--type", "http"],
				removeArgs: ["mcp", "remove", SERVER_NAME],
				current: currentUrl(system),
				url,
			}),
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => null,
	};
}
