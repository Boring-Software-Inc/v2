import type { WorkflowDefinition, WorkflowNode } from "@tripwire/contracts";
import { isDeliverableUrl } from "@tripwire/utils";

/**
 * Set-only masking for webhook/discord node secrets (url, signingSecret). The
 * full value never leaves the server: on read it is blanked and a `*Set`
 * marker tells the editor "a value is stored, leave blank to keep it"; on save
 * a blank field restores the stored value, and only a genuinely new value
 * overwrites. This is display + transport masking; at-rest encryption is a
 * separate, tracked gap (docs/SECURITY.md).
 */

const SECRET_KEYS = ["url", "signingSecret"] as const;

function isDeliverySecretNode(
	node: WorkflowNode,
): node is Extract<WorkflowNode, { type: "action" }> {
	return (
		node.type === "action" &&
		(node.action === "webhook" || node.action === "discord")
	);
}

/** Blank stored secrets, marking which were set — for the read path. */
export function redactWorkflowSecrets(
	def: WorkflowDefinition,
): WorkflowDefinition {
	return {
		...def,
		nodes: def.nodes.map((node) => {
			if (!isDeliverySecretNode(node)) {
				return node;
			}
			const params = { ...(node.params ?? {}) };
			for (const key of SECRET_KEYS) {
				if (typeof params[key] === "string" && params[key] !== "") {
					params[key] = "";
					params[`${key}Set`] = true;
				}
			}
			return { ...node, params };
		}),
	};
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
			const incomingValue = params[key];
			if (incomingValue === "" || incomingValue === undefined) {
				// Blank ⇒ keep the stored value (set-only).
				if (typeof prior[key] === "string") {
					params[key] = prior[key];
				} else {
					delete params[key];
				}
			} else if (typeof incomingValue === "string") {
				if (key === "url" && !isDeliverableUrl(incomingValue)) {
					error = "webhook url must be https and not a private address";
				} else if (key === "url") {
					changedUrlNodes.push({
						nodeId: node.id,
						url: incomingValue,
						kind: node.action as "webhook" | "discord",
					});
				}
				if (key === "signingSecret" && incomingValue.length > 512) {
					error = "signing secret is too long";
				}
			}
		}
		return { ...node, params };
	});
	return { definition: { ...incoming, nodes }, error, changedUrlNodes };
}
