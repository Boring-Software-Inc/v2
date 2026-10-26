import { join } from "node:path";
import {
	configuredUrl,
	formatCommand,
	readSignIn,
	runOrThrow,
} from "#/agents/shell";
import type { Agent, SignInState } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import type { System } from "#/system";

function configDir(system: System): string {
	return system.env.CLAUDE_CONFIG_DIR || join(system.home, ".claude");
}

function userConfigFile(system: System): string {
	return system.env.CLAUDE_CONFIG_DIR
		? join(system.env.CLAUDE_CONFIG_DIR, ".claude.json")
		: join(system.home, ".claude.json");
}

export function claudeSignIn(stdout: string): SignInState {
	const status = /^\s*Status:\s*(.*)$/m.exec(stdout)?.[1] ?? "";
	if (/\bConnected\b/.test(status)) {
		return "signed-in";
	}
	if (/needs authentication/i.test(status)) {
		return "signed-out";
	}
	return "unknown";
}

export function createClaude(system: System): Agent {
	const binary = () => system.which("claude") ?? "claude";
	const addArgs = (url: string) => [
		"mcp",
		"add",
		"--transport",
		"http",
		SERVER_NAME,
		url,
		"--scope",
		"user",
	];
	return {
		id: "claude",
		name: "Claude Code",
		signInHint: `claude mcp login ${SERVER_NAME}, or /mcp inside Claude Code`,
		detect: () => system.which("claude") !== null,
		hasServer: async () =>
			configuredUrl(userConfigFile(system), "mcpServers", SERVER_NAME) !== null,
		addServer: async (url) => {
			const command = formatCommand("claude", addArgs(url));
			const current = configuredUrl(
				userConfigFile(system),
				"mcpServers",
				SERVER_NAME,
			);
			if (current === url) {
				return { target: command, outcome: "unchanged" };
			}
			if (current !== null) {
				await runOrThrow(system, binary(), [
					"mcp",
					"remove",
					SERVER_NAME,
					"--scope",
					"user",
				]);
			}
			await runOrThrow(system, binary(), addArgs(url));
			return {
				target: command,
				outcome: current === null ? "added" : "updated",
			};
		},
		skillsDirs: () => [join(configDir(system), "skills")],
		login: () => ({
			command: binary(),
			args: ["mcp", "login", SERVER_NAME],
			status: () =>
				readSignIn(system, binary(), ["mcp", "get", SERVER_NAME], claudeSignIn),
		}),
	};
}
