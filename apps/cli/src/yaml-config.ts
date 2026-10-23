import { isMap, parseDocument } from "yaml";
import { z } from "zod";
import {
	type MergedConfig,
	type MergeOutcome,
	readOrNull,
	type ServerEntry,
	writeAtomic,
} from "#/json-config";

const entrySchema = z.record(z.string(), z.json());

export function yamlServerEntry(
	text: string | null,
	key: string,
	name: string,
): ServerEntry | null {
	if (text === null) {
		return null;
	}
	const doc = parseDocument(text);
	if (doc.errors.length > 0) {
		return null;
	}
	const root = z
		.record(z.string(), z.unknown())
		.nullable()
		.safeParse(doc.toJS());
	const servers = z
		.record(z.string(), z.unknown())
		.safeParse(root.success ? root.data?.[key] : undefined);
	if (!(servers.success && name in servers.data)) {
		return null;
	}
	const parsed = entrySchema.safeParse(servers.data[name]);
	return parsed.success ? parsed.data : {};
}

export function mergeYamlEntry(
	text: string | null,
	source: string,
	key: string,
	name: string,
	entry: ServerEntry,
): MergedConfig {
	const doc = parseDocument(text ?? "");
	if (
		doc.errors.length > 0 ||
		!(doc.contents === null || isMap(doc.contents))
	) {
		throw new Error(`${source} is not a YAML mapping. Left it unchanged.`);
	}
	const servers = doc.get(key);
	if (servers !== undefined && servers !== null && !isMap(servers)) {
		throw new Error(
			`${source} has a "${key}" value that is not a mapping. Left it unchanged.`,
		);
	}
	const existing = yamlServerEntry(text, key, name);
	const merged = { ...(existing ?? {}), ...entry };
	if (existing && JSON.stringify(existing) === JSON.stringify(merged)) {
		return { outcome: "unchanged", text: text ?? "" };
	}
	if (servers === undefined || servers === null) {
		doc.set(key, doc.createNode({ [name]: merged }));
	} else {
		doc.setIn([key, name], doc.createNode(merged));
	}
	return { outcome: existing ? "updated" : "added", text: doc.toString() };
}

export function writeYamlEntry(
	path: string,
	key: string,
	name: string,
	entry: ServerEntry,
): MergeOutcome {
	const merged = mergeYamlEntry(readOrNull(path), path, key, name, entry);
	if (merged.outcome !== "unchanged") {
		writeAtomic(path, merged.text);
	}
	return merged.outcome;
}
