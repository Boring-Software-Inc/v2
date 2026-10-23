import { join } from "node:path";
import {
	appInstalled,
	macApps,
	sharedSkillsDir,
	xdgConfigHome,
} from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { readOrNull } from "#/json-config";
import type { System } from "#/system";
import { writeYamlEntry, yamlServerEntry } from "#/yaml-config";

const KEY = "extensions";

export function gooseConfigPath(system: System): string {
	const root = system.env.GOOSE_PATH_ROOT;
	if (root) {
		return join(root, "config", "config.yaml");
	}
	if (system.platform === "win32") {
		return join(
			system.env.APPDATA || join(system.home, "AppData", "Roaming"),
			"Block",
			"goose",
			"config",
			"config.yaml",
		);
	}
	return join(xdgConfigHome(system), "goose", "config.yaml");
}

export function createGoose(system: System): Agent {
	return {
		id: "goose",
		name: "Goose",
		signInHint: "the browser sign-in Goose opens on first use",
		detect: () =>
			system.which("goose") !== null ||
			appInstalled(system, macApps(system, ["Goose"])),
		hasServer: async () =>
			yamlServerEntry(readOrNull(gooseConfigPath(system)), KEY, SERVER_NAME) !==
			null,
		addServer: async (url) => ({
			target: gooseConfigPath(system),
			outcome: writeYamlEntry(gooseConfigPath(system), KEY, SERVER_NAME, {
				type: "streamable_http",
				name: SERVER_NAME,
				enabled: true,
				uri: url,
				headers: {},
				env_keys: [],
				envs: {},
				timeout: 300,
			}),
		}),
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => null,
	};
}
