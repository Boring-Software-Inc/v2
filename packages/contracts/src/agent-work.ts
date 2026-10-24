import { z } from "zod";
import { setupRunViewSchema } from "./setup.ts";
import { workflowDefinitionSchema, workflowNodeIdSchema } from "./workflow.ts";
import type { WorkflowChangeSet } from "./workflow-diff.ts";

export const AGENT_NODE_HOLD_MS = 40_000;
export const AGENT_SESSION_HOLD_MS = 120_000;
export const WORKFLOW_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const AGENT_TOUCH_LIMIT = 200;

export const agentActionSchema = z.enum(["read", "write", "edit", "delete"]);
export type AgentAction = z.infer<typeof agentActionSchema>;

export const agentNodeTouchSchema = z.object({
	id: workflowNodeIdSchema,
	action: agentActionSchema,
	at: z.iso.datetime(),
});
export type AgentNodeTouch = z.infer<typeof agentNodeTouchSchema>;

export const agentNodeTouchesSchema = z
	.array(agentNodeTouchSchema)
	.max(AGENT_TOUCH_LIMIT);

const idListSchema = z.array(z.string());

export const workflowChangeSetSchema = z.object({
	renamed: z.boolean(),
	nodes: z.object({
		added: idListSchema,
		changed: idListSchema,
		removed: idListSchema,
	}),
	edges: z.object({ added: idListSchema, removed: idListSchema }),
}) satisfies z.ZodType<WorkflowChangeSet>;

export const agentPresenceSchema = z.object({
	userId: z.string(),
	clientId: z.string(),
	name: z.string(),
	lastSignalAt: z.iso.datetime(),
	finishedAt: z.iso.datetime().nullable(),
	nodes: agentNodeTouchesSchema,
});
export type AgentPresence = z.infer<typeof agentPresenceSchema>;

export const workflowDraftStatusSchema = z.enum([
	"open",
	"promoted",
	"discarded",
]);
export type WorkflowDraftStatus = z.infer<typeof workflowDraftStatusSchema>;

export const workflowDraftViewSchema = z.object({
	id: z.string(),
	name: z.string(),
	status: workflowDraftStatusSchema,
	definition: workflowDefinitionSchema.nullable(),
	revision: z.number().int().min(0),
	lastChange: workflowChangeSetSchema.nullable(),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
	expiresAt: z.iso.datetime(),
});
export type WorkflowDraftView = z.infer<typeof workflowDraftViewSchema>;

export const workflowWorkSchema = z.object({
	repoId: z.string(),
	definitionId: z.string(),
	workflowId: z.string().nullable(),
	draft: workflowDraftViewSchema.nullable(),
	agents: z.array(agentPresenceSchema),
});
export type WorkflowWork = z.infer<typeof workflowWorkSchema>;

export const liveMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("work"),
		repoFullName: z.string(),
		work: workflowWorkSchema,
	}),
	z.object({
		type: z.literal("setup"),
		orgId: z.string(),
		run: setupRunViewSchema,
	}),
]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;

export const liveNotificationSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("work"),
		repoId: z.string(),
		definitionId: z.string(),
	}),
	z.object({ type: z.literal("setup"), runId: z.string() }),
]);
export type LiveNotification = z.infer<typeof liveNotificationSchema>;

export const LIVE_CHANNEL = "agent";

function ms(at: string): number {
	return Date.parse(at);
}

export function agentWorking(agent: AgentPresence, now: Date): boolean {
	return (
		agent.finishedAt === null &&
		now.getTime() - ms(agent.lastSignalAt) < AGENT_SESSION_HOLD_MS
	);
}

export function workingAgents(
	work: Pick<WorkflowWork, "agents"> | null | undefined,
	now: Date,
): AgentPresence[] {
	return (work?.agents ?? []).filter((agent) => agentWorking(agent, now));
}

export interface LiveNodeTouch extends AgentNodeTouch {
	agent: string;
}

export function liveNodeTouches(
	work: Pick<WorkflowWork, "agents"> | null | undefined,
	now: Date,
): Map<string, LiveNodeTouch> {
	const live = new Map<string, LiveNodeTouch>();
	for (const agent of workingAgents(work, now)) {
		for (const touch of agent.nodes) {
			if (now.getTime() - ms(touch.at) >= AGENT_NODE_HOLD_MS) {
				continue;
			}
			const held = live.get(touch.id);
			if (!held || ms(held.at) < ms(touch.at)) {
				live.set(touch.id, { ...touch, agent: agent.name });
			}
		}
	}
	return live;
}

/** Milliseconds until the next outline or presence clears on its own. */
export function workSettlesIn(
	work: Pick<WorkflowWork, "agents"> | null | undefined,
	now: Date,
): number | null {
	let soonest: number | null = null;
	const consider = (deadline: number) => {
		const wait = deadline - now.getTime();
		if (wait > 0 && (soonest === null || wait < soonest)) {
			soonest = wait;
		}
	};
	for (const agent of workingAgents(work, now)) {
		consider(ms(agent.lastSignalAt) + AGENT_SESSION_HOLD_MS);
		for (const touch of agent.nodes) {
			consider(ms(touch.at) + AGENT_NODE_HOLD_MS);
		}
	}
	return soonest;
}

export function touchesFromChangeSet(
	set: WorkflowChangeSet,
	at: Date,
): AgentNodeTouch[] {
	const stamp = at.toISOString();
	return [
		...set.nodes.added.map((id) => ({ id, action: "write" as const })),
		...set.nodes.changed.map((id) => ({ id, action: "edit" as const })),
		...set.nodes.removed.map((id) => ({ id, action: "delete" as const })),
	].map((touch) => ({ ...touch, at: stamp }));
}

export function mergeTouches(
	held: readonly AgentNodeTouch[],
	incoming: readonly AgentNodeTouch[],
	now: Date,
): AgentNodeTouch[] {
	const fresh = new Map<string, AgentNodeTouch>();
	for (const touch of held) {
		if (now.getTime() - ms(touch.at) < AGENT_NODE_HOLD_MS) {
			fresh.set(touch.id, touch);
		}
	}
	for (const touch of incoming) {
		fresh.delete(touch.id);
		fresh.set(touch.id, touch);
	}
	return [...fresh.values()].slice(-AGENT_TOUCH_LIMIT);
}

export function releaseTouches(
	held: readonly AgentNodeTouch[],
	ids: readonly string[] | undefined,
): AgentNodeTouch[] {
	if (!ids) {
		return [];
	}
	const released = new Set(ids);
	return held.filter((touch) => !released.has(touch.id));
}
