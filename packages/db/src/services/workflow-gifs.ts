import {
	type CloseGif,
	closeGifSchema,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import type { Db } from "../client.ts";
import { resolveCachedGiphyGif } from "./giphy.ts";

type GifResolver = (gifId: string) => Promise<CloseGif | null>;

export async function settleWorkflowGifsWith(
	definition: WorkflowDefinition,
	resolve: GifResolver,
): Promise<WorkflowDefinition> {
	const resolved = new Map<string, CloseGif | null>();
	const nodes = [];
	for (const node of definition.nodes) {
		if (node.type !== "action" || node.action !== "post-comment") {
			nodes.push(node);
			continue;
		}
		const parsed = closeGifSchema.safeParse(node.params?.gif);
		if (!parsed.success || !parsed.data) {
			nodes.push(node);
			continue;
		}
		if (!resolved.has(parsed.data.id)) {
			resolved.set(parsed.data.id, await resolve(parsed.data.id));
		}
		nodes.push({
			...node,
			params: { ...node.params, gif: resolved.get(parsed.data.id) ?? null },
		});
	}
	return workflowDefinitionSchema.parse({ ...definition, nodes });
}

export async function settleWorkflowGifs(
	db: Pick<Db, "select">,
	definition: WorkflowDefinition,
): Promise<WorkflowDefinition> {
	return settleWorkflowGifsWith(definition, (gifId) =>
		resolveCachedGiphyGif(db, gifId),
	);
}
