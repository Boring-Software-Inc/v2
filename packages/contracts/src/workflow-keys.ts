import type { WorkflowDefinition } from "./workflow.ts";

const MAX_SLUG = 48;
const FALLBACK_SLUG = "workflow";

export function workflowSlug(name: string): string {
	const words = name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	let slug = "";
	for (const word of words) {
		const next = slug ? `${slug}-${word}` : word;
		if (next.length > MAX_SLUG) {
			break;
		}
		slug = next;
	}
	return slug || words[0]?.slice(0, MAX_SLUG) || FALLBACK_SLUG;
}

export interface NamedWorkflow {
	id: string;
	name: string;
}

export function workflowKeys(
	workflows: readonly NamedWorkflow[],
	keep: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
	const used = new Set<string>();
	const keys = new Map<string, string>();
	for (const workflow of workflows) {
		const kept = keep.get(workflow.id);
		if (kept && !used.has(kept)) {
			used.add(kept);
			keys.set(workflow.id, kept);
		}
	}
	for (const workflow of workflows) {
		if (keys.has(workflow.id)) {
			continue;
		}
		const base = workflowSlug(workflow.name || workflow.id);
		let key = base;
		for (let n = 2; used.has(key); n++) {
			key = `${base}-${n}`;
		}
		used.add(key);
		keys.set(workflow.id, key);
	}
	return keys;
}

export type WorkflowMatchKind = "mapping" | "id" | "name" | "new";

export interface WorkflowMatch {
	key: string;
	id: string;
	by: WorkflowMatchKind;
}

export interface MatchedWorkflows {
	definitions: WorkflowDefinition[];
	matches: WorkflowMatch[];
}

export function matchWorkflowIds(
	compiled: readonly WorkflowDefinition[],
	server: readonly NamedWorkflow[],
	mapping: Readonly<Record<string, string>> = {},
): MatchedWorkflows {
	const serverIds = new Set(server.map((workflow) => workflow.id));
	const claimed = new Set<string>();
	const found = new Map<string, WorkflowMatch>();
	for (const definition of compiled) {
		const mapped = mapping[definition.id];
		if (mapped && !claimed.has(mapped)) {
			claimed.add(mapped);
			found.set(definition.id, {
				key: definition.id,
				id: mapped,
				by: "mapping",
			});
		}
	}
	for (const definition of compiled) {
		if (
			!found.has(definition.id) &&
			serverIds.has(definition.id) &&
			!claimed.has(definition.id)
		) {
			claimed.add(definition.id);
			found.set(definition.id, {
				key: definition.id,
				id: definition.id,
				by: "id",
			});
		}
	}
	const bySlug = new Map(
		[...workflowKeys(server)].map(([id, key]) => [key, id]),
	);
	for (const definition of compiled) {
		const id = bySlug.get(definition.id);
		if (!found.has(definition.id) && id && !claimed.has(id)) {
			claimed.add(id);
			found.set(definition.id, { key: definition.id, id, by: "name" });
		}
	}
	const matches = compiled.map(
		(definition) =>
			found.get(definition.id) ?? {
				key: definition.id,
				id: definition.id,
				by: "new" as const,
			},
	);
	return {
		definitions: compiled.map((definition, index) => ({
			...definition,
			id: matches[index]?.id ?? definition.id,
		})),
		matches,
	};
}
