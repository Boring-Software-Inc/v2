import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { formatCommand, readSignIn, runOrThrow } from "#/agents/shell";
import type { Agent, SignInState } from "#/agents/types";
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

const codexListSchema = z.array(
	z.object({ name: z.string(), auth_status: z.string().nullish() }),
);

export function codexSignIn(stdout: string): SignInState {
	try {
		const list = codexListSchema.safeParse(JSON.parse(stdout));
		const status = list.success
			? list.data.find((entry) => entry.name === SERVER_NAME)?.auth_status
			: undefined;
		if (status === "o_auth" || status === "bearer_token") {
			return "signed-in";
		}
		return status === "not_logged_in" ? "signed-out" : "unknown";
	} catch {
		return "unknown";
	}
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
		signInHint: `codex mcp login ${SERVER_NAME}`,
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
			status: () =>
				readSignIn(system, binary(), ["mcp", "list", "--json"], codexSignIn),
		}),
	};
}
