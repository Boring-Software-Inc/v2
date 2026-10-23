import { join } from "node:path";
import { appInstalled, configuredUrl } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

function appPaths(system: System): string[] {
	if (system.platform === "darwin") {
		return system.macAppDirs.map((dir) => join(dir, "Cursor.app"));
	}
	if (system.platform === "win32") {
		return [
			join(system.home, "AppData", "Local", "Programs", "cursor", "Cursor.exe"),
		];
	}
	return [];
}

function cursorConfigPath(system: System): string {
	return join(system.home, ".cursor", "mcp.json");
}

export function createCursor(system: System): Agent {
	return {
		id: "cursor",
		name: "Cursor",
		signInHint: "the MCP settings in Cursor",
		detect: () =>
			system.which("cursor") !== null || appInstalled(system, appPaths(system)),
		hasServer: async () =>
			configuredUrl(cursorConfigPath(system), "mcpServers", SERVER_NAME) !==
			null,
		addServer: async (url) => ({
			target: cursorConfigPath(system),
			outcome: writeServerEntry(
				cursorConfigPath(system),
				"mcpServers",
				SERVER_NAME,
				{ url },
			),
		}),
		skillsDirs: () => [join(system.home, ".agents", "skills")],
		login: () => null,
	};
}
