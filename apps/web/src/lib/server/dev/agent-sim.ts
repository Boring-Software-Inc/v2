import {
	WORKFLOW_TEMPLATES,
	type WorkflowDefinition,
	type WorkflowNode,
} from "@tripwire/contracts";
import { agentWorkServices, type Db, orgServices, schema } from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { z } from "zod";

export const agentSimBodySchema = z.object({
	org: z.string().min(1),
	repo: z.string().min(1),
	action: z.enum(["build", "finish"]).default("build"),
	stepMs: z.number().int().min(200).max(10_000).default(1400),
	finishAfterMs: z.number().int().min(0).max(600_000).nullable().default(null),
	removeLast: z.boolean().default(false),
});
export type AgentSimBody = z.infer<typeof agentSimBodySchema>;

const SIM_CLIENT_ID = "dev-agent-sim";
const SIM_CLIENT_NAME = "Claude Code";

const BUILD_ORDER: readonly (readonly string[])[] = [
	["warn"],
	["mark-stale"],
	["warn-comment"],
	["close"],
	["close-comment", "close-it"],
	["reset", "unmark-stale"],
];

function staleTemplate(): WorkflowDefinition {
	const found = WORKFLOW_TEMPLATES.find(
		(tpl) => tpl.name === "Close stale change requests",
	);
	if (!found) {
		throw new Error("the stale template is missing");
	}
	return found.definition;
}

function upTo(
	template: WorkflowDefinition,
	id: string,
	step: number,
): WorkflowDefinition {
	const ids = new Set(BUILD_ORDER.slice(0, step + 1).flat());
	return {
		id,
		name: "Close stale PRs",
		version: 1,
		nodes: template.nodes.filter((node) => ids.has(node.id)),
		edges: template.edges.filter(
			(edge) => ids.has(edge.from) && ids.has(edge.to),
		),
	};
}

function tightened(definition: WorkflowDefinition): WorkflowDefinition {
	return {
		...definition,
		nodes: definition.nodes.map((node): WorkflowNode => {
			if (node.type !== "trigger" || !node.schedule) {
				return node;
			}
			return {
				...node,
				schedule: {
					...node.schedule,
					every: { n: 12, unit: "hours" },
					match:
						node.id === "warn" && node.schedule.match
							? {
									...node.schedule.match,
									inactiveFor: { n: 14, unit: "days" },
								}
							: node.schedule.match,
				},
			};
		}),
	};
}

function withoutLastStep(definition: WorkflowDefinition): WorkflowDefinition {
	const gone = new Set(BUILD_ORDER.at(-1));
	return {
		...definition,
		nodes: definition.nodes.filter((node) => !gone.has(node.id)),
		edges: definition.edges.filter(
			(edge) => !(gone.has(edge.from) || gone.has(edge.to)),
		),
	};
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureSimClient(db: Db): Promise<void> {
	await db
		.insert(schema.oauthClient)
		.values({
			id: generateId(),
			clientId: SIM_CLIENT_ID,
			name: SIM_CLIENT_NAME,
			redirectUris: ["http://localhost/dev-agent-sim"],
		})
		.onConflictDoNothing();
}

/**
 * Plays an agent building "Close stale PRs" through the same services the
 * MCP tools call, one step at a time, so the live view can be watched with
 * no agent and no api process. Dev only.
 */
export async function runAgentSim(input: {
	db: Db;
	userId: string;
	body: AgentSimBody;
}): Promise<{ draftId?: string; repoId: string; released?: number }> {
	const { db, body } = input;
	const orgs = await orgServices.listUserOrgs(db, input.userId);
	const org = orgs.find((candidate) => candidate.slug === body.org);
	if (!org) {
		throw new Error(`no org ${body.org} for this user`);
	}
	const repo = await orgServices.getOrgRepo(db, {
		orgId: org.id,
		repoName: body.repo,
	});
	if (!repo) {
		throw new Error(`no repo ${body.repo} in ${body.org}`);
	}
	await ensureSimClient(db);
	const agent = { userId: input.userId, clientId: SIM_CLIENT_ID };
	if (body.action === "finish") {
		const done = await agentWorkServices.finishWorkflowWork(db, {
			repoId: repo.id,
			agent,
		});
		return { repoId: repo.id, released: done.released };
	}
	const begun = await agentWorkServices.beginWorkflowWork(db, {
		repoId: repo.id,
		agent,
		name: "Close stale PRs",
	});
	const template = staleTemplate();
	const play = async () => {
		await wait(body.stepMs);
		let last = upTo(template, begun.definitionId, 0);
		for (let step = 0; step < BUILD_ORDER.length; step++) {
			last = upTo(template, begun.definitionId, step);
			await agentWorkServices.saveAgentDraft(db, {
				repoId: repo.id,
				agent,
				definition: last,
			});
			await wait(body.stepMs);
		}
		await agentWorkServices.saveAgentDraft(db, {
			repoId: repo.id,
			agent,
			definition: tightened(last),
		});
		if (body.removeLast) {
			await wait(body.stepMs);
			await agentWorkServices.saveAgentDraft(db, {
				repoId: repo.id,
				agent,
				definition: withoutLastStep(tightened(last)),
			});
		}
		if (body.finishAfterMs !== null) {
			await wait(body.finishAfterMs);
			await agentWorkServices.finishWorkflowWork(db, {
				repoId: repo.id,
				agent,
			});
		}
	};
	play().catch(() => undefined);
	return { draftId: begun.draftId, repoId: repo.id };
}
