import { join } from "node:path";
import {
	appInstalled,
	configuredUrl,
	firstOnPath,
	macApps,
} from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

function configPath(system: System): string {
	return join(system.home, ".kiro", "settings", "mcp.json");
}

export function createKiro(system: System): Agent {
	return {
		id: "kiro",
		name: "Kiro",
		signInHint: "the browser sign-in Kiro opens on first use, or /mcp auth",
		detect: () =>
			firstOnPath(system, ["kiro-cli", "kiro"]) !== null ||
			appInstalled(system, macApps(system, ["Kiro"])),
		hasServer: async () =>
			configuredUrl(configPath(system), "mcpServers", SERVER_NAME) !== null,
		addServer: async (url) => ({
			target: configPath(system),
			outcome: writeServerEntry(configPath(system), "mcpServers", SERVER_NAME, {
				url,
			}),
		}),
		skillsDirs: () => [join(system.home, ".kiro", "skills")],
		login: () => null,
	};
}
