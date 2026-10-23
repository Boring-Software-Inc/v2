import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	applyEdits,
	type FormattingOptions,
	modify,
	type ParseError,
	parse,
} from "jsonc-parser/lib/esm/main.js";
import { z } from "zod";

export type MergeOutcome = "added" | "updated" | "unchanged";

export interface MergedConfig {
	outcome: MergeOutcome;
	text: string;
}

const entrySchema = z.record(z.string(), z.json());
const configSchema = z.record(z.string(), z.json());

export type ServerEntry = z.infer<typeof entrySchema>;

export interface MergeOptions {
	defaults?: ServerEntry;
}

const FORMAT: FormattingOptions = {
	insertSpaces: true,
	tabSize: 2,
	eol: "\n",
};

export function parseJsonc(text: string): unknown {
	const errors: ParseError[] = [];
	const value: unknown = parse(text, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	});
	if (errors.length > 0) {
		throw new Error("invalid JSON");
	}
	return value;
}

function parseConfig(text: string | null, source: string) {
	if (text === null || text.trim() === "") {
		return {};
	}
	try {
		return configSchema.parse(parseJsonc(text));
	} catch {
		throw new Error(`${source} is not a JSON object. Left it unchanged.`);
	}
}

export function mergeServerEntry(
	text: string | null,
	source: string,
	key: string,
	name: string,
	entry: ServerEntry,
	options: MergeOptions = {},
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
	const missingDefaults = Object.entries(options.defaults ?? {}).filter(
		([field]) => !(field in config),
	);
	if (
		existing &&
		missingDefaults.length === 0 &&
		JSON.stringify(existing) === JSON.stringify(merged)
	) {
		return { outcome: "unchanged", text: text ?? "" };
	}
	let next = text && text.trim() !== "" ? text : "{}\n";
	for (const [field, value] of missingDefaults) {
		next = applyEdits(
			next,
			modify(next, [field], value, { formattingOptions: FORMAT }),
		);
	}
	const path = serversParse.data ? [key, name] : [key];
	const value = serversParse.data ? merged : { [name]: merged };
	next = applyEdits(
		next,
		modify(next, path, value, { formattingOptions: FORMAT }),
	);
	return {
		outcome: existing ? "updated" : "added",
		text: next.endsWith("\n") ? next : `${next}\n`,
	};
}

export function readOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

export function writeAtomic(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.tripwire-${process.pid}.tmp`;
	writeFileSync(temp, text);
	renameSync(temp, path);
}

export function writeServerEntry(
	path: string,
	key: string,
	name: string,
	entry: ServerEntry,
	options: MergeOptions = {},
): MergeOutcome {
	const merged = mergeServerEntry(
		readOrNull(path),
		path,
		key,
		name,
		entry,
		options,
	);
	if (merged.outcome !== "unchanged") {
		writeAtomic(path, merged.text);
	}
	return merged.outcome;
}
