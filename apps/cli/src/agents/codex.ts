import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCommand, runOrThrow } from "#/agents/shell";
import type { Agent } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import type { System } from "#/system";

function codexHome(system: System): string {
	return system.env.CODEX_HOME || join(system.home, ".codex");
}

export function codexServerUrl(toml: string, name: string): string | null {
	const lines = toml.split(/\r?\n/);
	const header = new RegExp(
		`^\\s*\\[\\s*mcp_servers\\.(?:"${name}"|${name})\\s*\\]\\s*$`,
	);
	const start = lines.findIndex((line) => header.test(line));
	if (start === -1) {
		return null;
	}
	for (const line of lines.slice(start + 1)) {
		if (/^\s*\[/.test(line)) {
			break;
		}
		const match = line.match(/^\s*url\s*=\s*"([^"]*)"/);
		if (match?.[1] !== undefined) {
			return match[1];
		}
	}
	return "";
}

function currentUrl(system: System): string | null {
	try {
		return codexServerUrl(
			readFileSync(join(codexHome(system), "config.toml"), "utf8"),
			SERVER_NAME,
		);
	} catch {
		return null;
	}
}

export function createCodex(system: System): Agent {
	const binary = () => system.which("codex") ?? "codex";
	const addArgs = (url: string) => ["mcp", "add", SERVER_NAME, "--url", url];
	return {
		id: "codex",
		name: "Codex",
		signInHint: "codex mcp login tripwire",
		detect: () => system.which("codex") !== null,
		hasServer: async () => currentUrl(system) !== null,
		addServer: async (url) => {
			const command = formatCommand("codex", addArgs(url));
			const current = currentUrl(system);
			if (current === url) {
				return { target: command, outcome: "unchanged" };
			}
			if (current !== null) {
				await runOrThrow(system, binary(), ["mcp", "remove", SERVER_NAME]);
			}
			await runOrThrow(system, binary(), addArgs(url));
			return {
				target: command,
				outcome: current === null ? "added" : "updated",
			};
		},
		skillsDirs: () => [join(system.home, ".agents", "skills")],
		login: () => ({
			command: binary(),
			args: ["mcp", "login", SERVER_NAME],
		}),
	};
}
