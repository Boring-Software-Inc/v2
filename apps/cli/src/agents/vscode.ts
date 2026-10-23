import { join } from "node:path";
import {
	appInstalled,
	configuredUrl,
	formatCommand,
	runOrThrow,
} from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

const MAC_APP = "Visual Studio Code.app";

function windowsInstall(system: System): string {
	return join(
		system.env.LOCALAPPDATA || join(system.home, "AppData", "Local"),
		"Programs",
		"Microsoft VS Code",
	);
}

function appPaths(system: System): string[] {
	if (system.platform === "darwin") {
		return system.macAppDirs.map((dir) => join(dir, MAC_APP));
	}
	if (system.platform === "win32") {
		return [join(windowsInstall(system), "Code.exe")];
	}
	return [];
}

function bundledClis(system: System): string[] {
	if (system.platform === "darwin") {
		return appPaths(system).map((app) =>
			join(app, "Contents", "Resources", "app", "bin", "code"),
		);
	}
	if (system.platform === "win32") {
		return [join(windowsInstall(system), "bin", "code.cmd")];
	}
	return [];
}

function codeCli(system: System): string | null {
	const onPath = system.which("code");
	if (onPath) {
		return onPath;
	}
	return bundledClis(system).find((path) => system.exists(path)) ?? null;
}

function vscodeUserConfigPath(system: System): string {
	if (system.platform === "darwin") {
		return join(
			system.home,
			"Library",
			"Application Support",
			"Code",
			"User",
			"mcp.json",
		);
	}
	if (system.platform === "win32") {
		return join(
			system.env.APPDATA || join(system.home, "AppData", "Roaming"),
			"Code",
			"User",
			"mcp.json",
		);
	}
	return join(
		system.env.XDG_CONFIG_HOME || join(system.home, ".config"),
		"Code",
		"User",
		"mcp.json",
	);
}

export function createVscode(system: System): Agent {
	return {
		id: "vscode",
		name: "VS Code",
		signInHint: "the MCP server list in VS Code",
		detect: () =>
			codeCli(system) !== null || appInstalled(system, appPaths(system)),
		hasServer: async () =>
			configuredUrl(vscodeUserConfigPath(system), "servers", SERVER_NAME) !==
			null,
		addServer: async (url) => {
			const configPath = vscodeUserConfigPath(system);
			const current = configuredUrl(configPath, "servers", SERVER_NAME);
			const definition = JSON.stringify({
				name: SERVER_NAME,
				type: "http",
				url,
			});
			const args = ["--add-mcp", definition];
			const cli = codeCli(system);
			if (!cli) {
				return {
					target: configPath,
					outcome: writeServerEntry(configPath, "servers", SERVER_NAME, {
						type: "http",
						url,
					}),
				};
			}
			const command = formatCommand("code", args);
			if (current === url) {
				return { target: command, outcome: "unchanged" };
			}
			await runOrThrow(system, cli, args);
			return {
				target: command,
				outcome: current === null ? "added" : "updated",
			};
		},
		skillsDirs: () => [join(system.home, ".agents", "skills")],
		login: () => null,
	};
}
