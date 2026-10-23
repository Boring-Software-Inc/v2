import { join } from "node:path";
import { appInstalled, configuredUrl, macApps } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

function configPath(system: System): string {
	return join(system.home, ".gemini", "config", "mcp_config.json");
}

function hasApp(system: System): boolean {
	return appInstalled(system, macApps(system, ["Antigravity"]));
}

export function createAntigravity(system: System): Agent {
	return {
		id: "antigravity",
		name: "Google Antigravity",
		signInHint: "/mcp inside agy, or Settings > Customizations in Antigravity",
		detect: () => system.which("agy") !== null || hasApp(system),
		hasServer: async () =>
			configuredUrl(configPath(system), "mcpServers", SERVER_NAME, [
				"serverUrl",
				"url",
			]) !== null,
		addServer: async (url) => ({
			target: configPath(system),
			outcome: writeServerEntry(configPath(system), "mcpServers", SERVER_NAME, {
				serverUrl: url,
			}),
		}),
		skillsDirs: () => {
			const dirs: string[] = [];
			if (system.which("agy") !== null) {
				dirs.push(join(system.home, ".gemini", "antigravity-cli", "skills"));
			}
			if (hasApp(system)) {
				dirs.push(join(system.home, ".gemini", "config", "skills"));
			}
			return dirs;
		},
		login: () => null,
	};
}
