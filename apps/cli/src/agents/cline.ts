import { join } from "node:path";
import {
	configuredUrl,
	editorExtensionInstalled,
	formatCommand,
	runOrThrow,
} from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

function clineDir(system: System): string {
	return system.env.CLINE_DIR || join(system.home, ".cline");
}

function settingsPath(system: System): string {
	return (
		system.env.CLINE_MCP_SETTINGS_PATH ||
		join(clineDir(system), "data", "settings", "cline_mcp_settings.json")
	);
}

export function createCline(system: System): Agent {
	const currentUrl = () =>
		configuredUrl(settingsPath(system), "mcpServers", SERVER_NAME);
	return {
		id: "cline",
		name: "Cline",
		signInHint:
			"Authorize OAuth in cline mcp, or the MCP Servers panel in Cline",
		detect: () =>
			system.which("cline") !== null ||
			editorExtensionInstalled(system, "saoudrizwan.claude-dev"),
		hasServer: async () => currentUrl() !== null,
		addServer: async (url) => {
			const current = currentUrl();
			if (current === url) {
				return { target: settingsPath(system), outcome: "unchanged" };
			}
			const cli = system.which("cline");
			if (cli && current === null) {
				const args = [
					"mcp",
					"add",
					SERVER_NAME,
					url,
					"--transport",
					"http",
					"--yes",
				];
				await runOrThrow(system, cli, args);
				return { target: formatCommand("cline", args), outcome: "added" };
			}
			return {
				target: settingsPath(system),
				outcome: writeServerEntry(
					settingsPath(system),
					"mcpServers",
					SERVER_NAME,
					{
						type: "streamableHttp",
						url,
						disabled: false,
					},
				),
			};
		},
		skillsDirs: () => [join(system.home, ".cline", "skills")],
		login: () => null,
	};
}
