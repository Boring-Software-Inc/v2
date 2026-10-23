import { join } from "node:path";
import {
	appInstalled,
	configuredUrl,
	macApps,
	sharedSkillsDir,
	xdgConfigHome,
} from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

function settingsPath(system: System): string {
	if (system.platform === "win32") {
		return join(
			system.env.APPDATA || join(system.home, "AppData", "Roaming"),
			"Zed",
			"settings.json",
		);
	}
	if (system.platform === "darwin") {
		return join(system.home, ".config", "zed", "settings.json");
	}
	return join(xdgConfigHome(system), "zed", "settings.json");
}

export function createZed(system: System): Agent {
	return {
		id: "zed",
		name: "Zed",
		signInHint: "the sign-in prompt in the Zed Agent Panel",
		detect: () =>
			system.which("zed") !== null ||
			appInstalled(system, macApps(system, ["Zed", "Zed Preview"])),
		hasServer: async () =>
			configuredUrl(settingsPath(system), "context_servers", SERVER_NAME) !==
			null,
		addServer: async (url) => ({
			target: settingsPath(system),
			outcome: writeServerEntry(
				settingsPath(system),
				"context_servers",
				SERVER_NAME,
				{ url },
			),
		}),
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => null,
	};
}
