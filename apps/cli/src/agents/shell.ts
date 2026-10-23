import { readFileSync } from "node:fs";
import { z } from "zod";
import type { System } from "#/system";

const serversSchema = z.object({
	mcpServers: z
		.record(z.string(), z.looseObject({ url: z.string().optional() }))
		.optional(),
	servers: z
		.record(z.string(), z.looseObject({ url: z.string().optional() }))
		.optional(),
});

export function configuredUrl(
	path: string,
	key: "mcpServers" | "servers",
	name: string,
): string | null {
	try {
		const parsed = serversSchema.parse(JSON.parse(readFileSync(path, "utf8")));
		const entry = parsed[key]?.[name];
		if (!entry) {
			return null;
		}
		return entry.url ?? "";
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
