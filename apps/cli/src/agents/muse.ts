import { join } from "node:path";
import { configuredUrl, sharedSkillsDir, xdgConfigHome } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

function settingsPath(system: System): string {
	return join(xdgConfigHome(system), "muse", "settings.json");
}

export function createMuse(system: System): Agent {
	return {
		id: "muse",
		name: "Muse Code",
		signInHint: "muse mcp login tripwire",
		detect: () => system.which("muse") !== null,
		hasServer: async () =>
			configuredUrl(settingsPath(system), "mcp_servers", SERVER_NAME) !== null,
		addServer: async (url) => ({
			target: settingsPath(system),
			outcome: writeServerEntry(
				settingsPath(system),
				"mcp_servers",
				SERVER_NAME,
				{ transport: "streamable_http", url, enabled: true, mode: "optional" },
				{ defaults: { schema_version: 1 } },
			),
		}),
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => ({
			command: system.which("muse") ?? "muse",
			args: ["mcp", "login", SERVER_NAME],
			status: async () => "unknown",
		}),
	};
}
