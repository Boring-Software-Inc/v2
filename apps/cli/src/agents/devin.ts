import { join } from "node:path";
import { appInstalled, configuredUrl } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { type MergeOutcome, writeServerEntry } from "#/json-config";
import type { System } from "#/system";

const CONFIG_FILE = "mcp_config.json";

function devinDir(system: System): string {
	if (system.platform === "win32") {
		return join(
			system.env.APPDATA || join(system.home, "AppData", "Roaming"),
			"devin",
		);
	}
	return join(
		system.env.XDG_CONFIG_HOME || join(system.home, ".config"),
		"devin",
	);
}

function windsurfDir(system: System): string {
	return join(system.home, ".codeium", "windsurf");
}

function appPaths(system: System, app: string): string[] {
	if (system.platform === "darwin") {
		return system.macAppDirs.map((dir) => join(dir, `${app}.app`));
	}
	if (system.platform === "win32") {
		return [
			join(
				system.env.LOCALAPPDATA || join(system.home, "AppData", "Local"),
				"Programs",
				app,
				`${app}.exe`,
			),
		];
	}
	return [];
}

function hasDevin(system: System): boolean {
	return (
		system.which("devin") !== null ||
		appInstalled(system, appPaths(system, "Devin"))
	);
}

function hasWindsurf(system: System): boolean {
	return (
		system.which("windsurf") !== null ||
		appInstalled(system, appPaths(system, "Windsurf"))
	);
}

function devinConfigPaths(system: System): string[] {
	const paths: string[] = [];
	if (hasDevin(system) || !hasWindsurf(system)) {
		paths.push(join(devinDir(system), CONFIG_FILE));
	}
	if (hasWindsurf(system)) {
		paths.push(join(windsurfDir(system), CONFIG_FILE));
	}
	return paths;
}

const RANK = {
	unchanged: 0,
	updated: 1,
	added: 2,
} as const satisfies Record<MergeOutcome, number>;

export function createDevin(system: System): Agent {
	return {
		id: "devin",
		name: "Devin Desktop (Windsurf)",
		signInHint: "the MCP settings in Devin Desktop",
		detect: () => hasDevin(system) || hasWindsurf(system),
		hasServer: async () =>
			devinConfigPaths(system).some(
				(path) => configuredUrl(path, "mcpServers", SERVER_NAME) !== null,
			),
		addServer: async (url) => {
			const paths = devinConfigPaths(system);
			const outcomes = paths.map((path) =>
				writeServerEntry(path, "mcpServers", SERVER_NAME, { serverUrl: url }),
			);
			const outcome = outcomes.reduce<MergeOutcome>(
				(best, next) => (RANK[next] > RANK[best] ? next : best),
				"unchanged",
			);
			return { target: paths.join(", "), outcome };
		},
		skillsDirs: () => {
			const dirs: string[] = [];
			if (hasDevin(system) || !hasWindsurf(system)) {
				dirs.push(join(system.home, ".agents", "skills"));
			}
			if (hasWindsurf(system)) {
				dirs.push(join(windsurfDir(system), "skills"));
			}
			return dirs;
		},
		login: () => null,
	};
}
