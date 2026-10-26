import { join } from "node:path";
import {
	appInstalled,
	configuredUrl,
	editorExtensionInstalled,
	firstExisting,
	firstOnPath,
	macApps,
	readSignIn,
	sharedSkillsDir,
	xdgConfigHome,
} from "#/agents/shell";
import type { Agent, SignInState } from "#/agents/types";
import { SERVER_NAME } from "#/config";
import { writeServerEntry } from "#/json-config";
import type { System } from "#/system";

interface OpencodeFamily {
	id: string;
	name: string;
	binaries: string[];
	apps: string[];
	extensionId: string | null;
	configPath: (system: System) => string;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function opencodeSignIn(stdout: string): SignInState {
	const line = stdout
		.replace(ANSI, "")
		.split(/\r?\n/)
		.find((text) => new RegExp(`(^|\\s)${SERVER_NAME}\\s`).test(text));
	if (line === undefined) {
		return "unknown";
	}
	if (/✓/.test(line) && /\bconnected\b/.test(line)) {
		return "signed-in";
	}
	return /needs authentication/.test(line) ? "signed-out" : "unknown";
}

function createOpencodeFamily(system: System, family: OpencodeFamily): Agent {
	const cli = () => firstOnPath(system, family.binaries);
	const currentUrl = () =>
		configuredUrl(family.configPath(system), "mcp", SERVER_NAME);
	return {
		id: family.id,
		name: family.name,
		signInHint: `${family.binaries[0]} mcp auth ${SERVER_NAME}`,
		detect: () =>
			cli() !== null ||
			appInstalled(system, macApps(system, family.apps)) ||
			(family.extensionId !== null &&
				editorExtensionInstalled(system, family.extensionId)),
		hasServer: async () => currentUrl() !== null,
		addServer: async (url) => {
			const path = family.configPath(system);
			return {
				target: path,
				outcome: writeServerEntry(path, "mcp", SERVER_NAME, {
					type: "remote",
					url,
					enabled: true,
				}),
			};
		},
		skillsDirs: () => [sharedSkillsDir(system)],
		login: () => {
			const binary = cli();
			return binary
				? {
						command: binary,
						args: ["mcp", "auth", SERVER_NAME],
						status: () =>
							readSignIn(system, binary, ["mcp", "list"], opencodeSignIn),
					}
				: null;
		},
	};
}

export function createOpencode(system: System): Agent {
	return createOpencodeFamily(system, {
		id: "opencode",
		name: "OpenCode",
		binaries: ["opencode"],
		apps: ["OpenCode"],
		extensionId: null,
		configPath: (sys) =>
			firstExisting(
				sys,
				join(xdgConfigHome(sys), "opencode"),
				["opencode.json", "opencode.jsonc"],
				"opencode.json",
			),
	});
}

export function createKilo(system: System): Agent {
	return createOpencodeFamily(system, {
		id: "kilo",
		name: "Kilo Code",
		binaries: ["kilo", "kilocode"],
		apps: [],
		extensionId: "kilocode.kilo-code",
		configPath: (sys) =>
			firstExisting(
				sys,
				sys.env.KILO_CONFIG_DIR || join(xdgConfigHome(sys), "kilo"),
				["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"],
				"kilo.json",
			),
	});
}
