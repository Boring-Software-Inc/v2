import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpChange } from "#/agents/types";
import { parseJsonc } from "#/json-config";
import type { System } from "#/system";

const recordSchema = z.record(z.string(), z.unknown());

export function configuredUrl(
	path: string,
	key: string,
	name: string,
	fields: string[] = ["url"],
): string | null {
	try {
		const config = recordSchema.parse(parseJsonc(readFileSync(path, "utf8")));
		const servers = recordSchema.safeParse(config[key]);
		if (!servers.success || !(name in servers.data)) {
			return null;
		}
		const entry = recordSchema.safeParse(servers.data[name]);
		if (!entry.success) {
			return "";
		}
		for (const field of fields) {
			const value = entry.data[field];
			if (typeof value === "string") {
				return value;
			}
		}
		return "";
	} catch {
		return null;
	}
}

export function formatCommand(command: string, args: string[]): string {
	const quoted = args.map((arg) =>
		/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
	);
	return [command, ...quoted].join(" ");
}

export async function runOrThrow(
	system: System,
	binary: string,
	args: string[],
): Promise<void> {
	const result = await system.run(binary, args);
	if (!result.ok) {
		throw new Error(
			result.stderr || result.stdout || `${formatCommand(binary, args)} failed`,
		);
	}
}

export function appInstalled(system: System, paths: string[]): boolean {
	return paths.some((path) => system.exists(path));
}

export function macApps(system: System, names: string[]): string[] {
	if (system.platform !== "darwin") {
		return [];
	}
	return system.macAppDirs.flatMap((dir) =>
		names.map((name) => join(dir, `${name}.app`)),
	);
}

export function firstOnPath(system: System, binaries: string[]): string | null {
	for (const binary of binaries) {
		const found = system.which(binary);
		if (found) {
			return found;
		}
	}
	return null;
}

const EDITOR_EXTENSION_DIRS = [
	".vscode",
	".vscode-insiders",
	".cursor",
	".windsurf",
];

export function editorExtensionInstalled(
	system: System,
	extensionId: string,
): boolean {
	const prefix = `${extensionId.toLowerCase()}-`;
	return EDITOR_EXTENSION_DIRS.some((dir) =>
		system
			.list(join(system.home, dir, "extensions"))
			.some((entry) => entry.toLowerCase().startsWith(prefix)),
	);
}

export function firstExisting(
	system: System,
	dir: string,
	files: string[],
	fallback: string,
): string {
	const found = files.find((file) => system.exists(join(dir, file)));
	return join(dir, found ?? fallback);
}

export function xdgConfigHome(system: System): string {
	return system.env.XDG_CONFIG_HOME || join(system.home, ".config");
}

export function sharedSkillsDir(system: System): string {
	return join(system.home, ".agents", "skills");
}

export interface CliAddOptions {
	binary: string;
	display: string;
	addArgs: string[];
	removeArgs: string[] | null;
	current: string | null;
	url: string;
}

export async function addWithCli(
	system: System,
	options: CliAddOptions,
): Promise<McpChange> {
	const target = formatCommand(options.display, options.addArgs);
	if (options.current === options.url) {
		return { target, outcome: "unchanged" };
	}
	if (options.current !== null && options.removeArgs) {
		await runOrThrow(system, options.binary, options.removeArgs);
	}
	await runOrThrow(system, options.binary, options.addArgs);
	return {
		target,
		outcome: options.current === null ? "added" : "updated",
	};
}
