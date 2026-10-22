import {
	type Forge,
	isScheduleTrigger,
	SCHEDULE_EVERY_MS,
	type TriggerSchedule,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
	repos,
	workflowDefinitions,
	workflowScheduleState,
} from "../schema/repos.ts";

export interface DueSchedule {
	workflowRowId: string;
	workflowId: string;
	nodeId: string;
	schedule: TriggerSchedule;
	repoId: string;
	repoFullName: string;
	repoOwner: string;
	repoName: string;
	repoExternalId: string;
	installationId: string | null;
	forge: Forge;
	lastTickAt: Date | null;
}

export function isScheduleDue(
	every: TriggerSchedule["every"],
	lastTickAt: Date | null,
	now: Date,
): boolean {
	return (
		lastTickAt === null ||
		now.getTime() - lastTickAt.getTime() >= SCHEDULE_EVERY_MS[every]
	);
}

export async function listDueSchedules(
	db: Db,
	now: Date,
): Promise<DueSchedule[]> {
	const rows = await db
		.select({
			workflowRowId: workflowDefinitions.id,
			definition: workflowDefinitions.definition,
			repoId: repos.id,
			repoFullName: repos.fullName,
			repoOwner: repos.owner,
			repoName: repos.name,
			repoExternalId: repos.externalId,
			installationId: repos.installationId,
			forge: repos.forge,
		})
		.from(workflowDefinitions)
		.innerJoin(repos, eq(repos.id, workflowDefinitions.repoId))
		.where(
			and(
				eq(workflowDefinitions.enabled, true),
				eq(repos.armed, true),
				isNull(repos.removedAt),
			),
		);
	if (rows.length === 0) {
		return [];
	}
	const states = await db.select().from(workflowScheduleState);
	const lastTick = new Map(
		states.map((state) => [
			`${state.workflowId}:${state.nodeId}`,
			state.lastTickAt,
		]),
	);
	return rows.flatMap((row) => {
		const parsed = workflowDefinitionSchema.safeParse(row.definition);
		if (!parsed.success) {
			return [];
		}
		return parsed.data.nodes.flatMap((node) => {
			if (
				node.type !== "trigger" ||
				!isScheduleTrigger(node) ||
				!node.schedule ||
				node.kinds.length > 1
			) {
				return [];
			}
			const lastTickAt =
				lastTick.get(`${row.workflowRowId}:${node.id}`) ?? null;
			if (!isScheduleDue(node.schedule.every, lastTickAt, now)) {
				return [];
			}
			return [
				{
					workflowRowId: row.workflowRowId,
					workflowId: parsed.data.id,
					nodeId: node.id,
					schedule: node.schedule,
					repoId: row.repoId,
					repoFullName: row.repoFullName,
					repoOwner: row.repoOwner,
					repoName: row.repoName,
					repoExternalId: row.repoExternalId,
					installationId: row.installationId,
					forge: row.forge,
					lastTickAt,
				},
			];
		});
	});
}

export async function markScheduleTicked(
	db: Db,
	input: {
		workflowRowId: string;
		nodeId: string;
		at: Date;
		error: string | null;
	},
): Promise<void> {
	await db
		.insert(workflowScheduleState)
		.values({
			workflowId: input.workflowRowId,
			nodeId: input.nodeId,
			lastTickAt: input.at,
			lastError: input.error,
		})
		.onConflictDoUpdate({
			target: [workflowScheduleState.workflowId, workflowScheduleState.nodeId],
			set: { lastTickAt: input.at, lastError: input.error },
		});
}

export async function getScheduleState(
	db: Db,
	workflowRowId: string,
	nodeId: string,
) {
	const rows = await db
		.select()
		.from(workflowScheduleState)
		.where(
			and(
				eq(workflowScheduleState.workflowId, workflowRowId),
				eq(workflowScheduleState.nodeId, nodeId),
			),
		);
	return rows[0] ?? null;
}
