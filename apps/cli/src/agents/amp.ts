import { join } from "node:path";
import {
	addWithCli,
	configuredUrl,
	firstExisting,
	sharedSkillsDir,
} from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import type { System } from "#/system";

function settingsPath(system: System): string {
	return firstExisting(
		system,
		join(system.home, ".config", "amp"),
		["settings.json", "settings.jsonc"],
		"settings.json",
	);
}

function currentUrl(system: System): string | null {
	return configuredUrl(settingsPath(system), "amp.mcpServers", SERVER_NAME);
}

export function createAmp(system: System): Agent {
	return {
		id: "amp",
		name: "Amp",
		signInHint: "the browser sign-in Amp opens when it starts",
		detect: () => system.which("amp") !== null,
		hasServer: async () => currentUrl(system) !== null,
		addServer: (url) =>
			addWithCli(system, {
				binary: system.which("amp") ?? "amp",
				display: "amp",
				addArgs: ["mcp", "add", SERVER_NAME, url],
				removeArgs: ["mcp", "remove", SERVER_NAME],
				current: currentUrl(system),
				url,
			}),
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => null,
	};
}
