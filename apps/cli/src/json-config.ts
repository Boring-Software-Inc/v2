import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export type MergeOutcome = "added" | "updated" | "unchanged";

export interface MergedConfig {
	outcome: MergeOutcome;
	text: string;
}

const entrySchema = z.record(z.string(), z.json());
const configSchema = z.record(z.string(), z.json());

export type ServerEntry = z.infer<typeof entrySchema>;

function parseConfig(text: string | null, source: string) {
	if (text === null || text.trim() === "") {
		return {};
	}
	let raw: z.infer<typeof configSchema>;
	try {
		raw = configSchema.parse(JSON.parse(text));
	} catch {
		throw new Error(`${source} is not a JSON object. Left it unchanged.`);
	}
	return raw;
}

export function mergeServerEntry(
	text: string | null,
	source: string,
	key: string,
	name: string,
	entry: ServerEntry,
): MergedConfig {
	const config = parseConfig(text, source);
	const serversParse = entrySchema.optional().safeParse(config[key]);
	if (!serversParse.success) {
		throw new Error(
			`${source} has a "${key}" value that is not an object. Left it unchanged.`,
		);
	}
	const servers = serversParse.data ?? {};
	const existingParse = entrySchema.optional().safeParse(servers[name]);
	const existing = existingParse.success ? existingParse.data : undefined;
	const merged = { ...(existing ?? {}), ...entry };
	if (existing && JSON.stringify(existing) === JSON.stringify(merged)) {
		return { outcome: "unchanged", text: text ?? "" };
	}
	const next = { ...config, [key]: { ...servers, [name]: merged } };
	return {
		outcome: existing ? "updated" : "added",
		text: `${JSON.stringify(next, null, 2)}\n`,
	};
}

function readOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

export function writeServerEntry(
	path: string,
	key: string,
	name: string,
	entry: ServerEntry,
): MergeOutcome {
	const merged = mergeServerEntry(readOrNull(path), path, key, name, entry);
	if (merged.outcome === "unchanged") {
		return merged.outcome;
	}
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.tripwire-${process.pid}.tmp`;
	writeFileSync(temp, merged.text);
	renameSync(temp, path);
	return merged.outcome;
}
