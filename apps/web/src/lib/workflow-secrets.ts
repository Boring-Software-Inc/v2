import type { WorkflowDefinition, WorkflowNode } from "@tripwire/contracts";
import { isDeliverableUrl } from "@tripwire/utils";
import { z } from "zod";

/**
 * Set-only masking for webhook/discord node secrets (url, signingSecret). The
 * full value never leaves the server: on read it is blanked and a `*Set`
 * marker tells the editor "a value is stored, leave blank to keep it"; on save
 * a blank field restores the stored value, and only a genuinely new value
 * overwrites. This is display + transport masking; at-rest encryption is a
 * separate, tracked gap (docs/SECURITY.md).
 */

const SECRET_KEYS = ["url", "signingSecret"] as const;
const optionalSecretValueSchema = z.string().optional();

type DeliverySecretNode = Extract<WorkflowNode, { type: "action" }> & {
	action: "webhook" | "discord";
};

function isDeliverySecretNode(node: WorkflowNode): node is DeliverySecretNode {
	return (
		node.type === "action" &&
		(node.action === "webhook" || node.action === "discord")
	);
}

export interface RestoreResult {
	definition: WorkflowDefinition;
	error?: string;
	/** webhook/discord nodes whose url was newly set this save — the save-time
	 * connection test targets exactly these (a kept, blank url is not retested). */
	changedUrlNodes: {
		nodeId: string;
		url: string;
		kind: "webhook" | "discord";
	}[];
}

/**
 * Merge incoming secrets over the stored definition for the write path: a
 * blank field keeps the stored value, a new value is validated (https + shape)
 * and overwrites, the `*Set` markers are stripped before persisting. Reuses
 * the guard's shape gate so an obviously bad url is rejected at save time
 * (the real gate is the resolved-IP check at delivery).
 */
export function restoreWorkflowSecrets(
	incoming: WorkflowDefinition,
	stored: WorkflowDefinition | null,
): RestoreResult {
	const storedById = new Map(
		(stored?.nodes ?? []).map((node) => [node.id, node]),
	);
	let error: string | undefined;
	const changedUrlNodes: {
		nodeId: string;
		url: string;
		kind: "webhook" | "discord";
	}[] = [];
	const nodes = incoming.nodes.map((node) => {
		if (!isDeliverySecretNode(node)) {
			return node;
		}
		const params = { ...(node.params ?? {}) };
		const priorNode = storedById.get(node.id);
		const prior =
			priorNode && isDeliverySecretNode(priorNode)
				? (priorNode.params ?? {})
				: {};
		for (const key of SECRET_KEYS) {
			delete params[`${key}Set`];
			const incomingValue = optionalSecretValueSchema.safeParse(params[key]);
			if (!incomingValue.success) {
				continue;
			}
			if (incomingValue.data === "" || incomingValue.data === undefined) {
				// Blank ⇒ keep the stored value (set-only).
				const priorValue = z.string().safeParse(prior[key]);
				if (priorValue.success) {
					params[key] = priorValue.data;
				} else {
					delete params[key];
				}
			} else {
				const value = incomingValue.data;
				if (key === "url" && !isDeliverableUrl(value)) {
					error =
						"The webhook URL must use HTTPS and must not be a private address.";
				} else if (key === "url") {
					changedUrlNodes.push({
						nodeId: node.id,
						url: value,
						kind: node.action,
					});
				}
				if (key === "signingSecret" && value.length > 512) {
					error = "The signing secret is too long.";
				}
			}
		}
		return { ...node, params };
	});
	return { definition: { ...incoming, nodes }, error, changedUrlNodes };
}
