import {
	type Forge,
	SCHEDULE_EVERY_MS,
	type ScheduledEvent,
} from "@tripwire/contracts";
import type { Db, DueSchedule } from "@tripwire/db";
import { eventServices, scheduleServices } from "@tripwire/db";
import type { ForgeThread } from "@tripwire/forge";
import { generateId, getErrorMessage } from "@tripwire/utils";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type { ForgeRuntime } from "../forge-runtime.ts";

export const SCHEDULE_TICK_QUEUE = "schedule-tick";
export const SCHEDULE_TICK_CRON = "*/5 * * * *";
export const MAX_THREADS_PER_TICK = 100;

const DAY_MS = 24 * 60 * 60_000;

export interface ScheduleTickDeps {
	db: Db;
	pool: Pool;
	boss: PgBoss;
	resolveForge: (forge: Forge) => ForgeRuntime | null;
	logger: Logger;
	now?: () => Date;
}

export interface ScheduleTickResult {
	schedules: number;
	events: number;
	errors: number;
}

export function scheduleTickId(
	every: DueSchedule["schedule"]["every"],
	now: Date,
): string {
	const size = SCHEDULE_EVERY_MS[every];
	return new Date(Math.floor(now.getTime() / size) * size).toISOString();
}

export function scheduleDeliveryId(
	due: Pick<DueSchedule, "workflowId" | "nodeId">,
	threadNumber: number,
	tickId: string,
): string {
	return `schedule:${due.workflowId}:${due.nodeId}:${threadNumber}:${tickId}`;
}

function scheduledEvent(
	due: DueSchedule,
	thread: ForgeThread,
	tickId: string,
	now: Date,
): ScheduledEvent {
	const { authorExternalId, authorAvatarUrl, ...rest } = thread;
	return {
		id: generateId(),
		forge: due.forge,
		deliveryId: scheduleDeliveryId(due, thread.number, tickId),
		repo: {
			owner: due.repoOwner,
			name: due.repoName,
			fullName: due.repoFullName,
		},
		repoExternalId: due.repoExternalId,
		...(due.installationId
			? { installationExternalId: due.installationId }
			: {}),
		actor: {
			login: thread.author,
			externalId: authorExternalId,
			...(authorAvatarUrl ? { avatarUrl: authorAvatarUrl } : {}),
		},
		occurredAt: now.toISOString(),
		receivedAt: now.toISOString(),
		kind: "schedule.matched",
		schedule: { workflowId: due.workflowId, nodeId: due.nodeId, tickId },
		thread: rest,
	};
}

async function tickOne(
	deps: ScheduleTickDeps,
	due: DueSchedule,
	now: Date,
): Promise<{ events: number; error: string | null }> {
	const listThreads = deps.resolveForge(due.forge)?.listThreads;
	if (!listThreads) {
		return { events: 0, error: "this forge cannot list threads" };
	}
	const { match } = due.schedule;
	const result = await listThreads(due.repoFullName, {
		subjects: match.subjects,
		state: match.state,
		updatedBefore: match.inactiveDays
			? new Date(now.getTime() - match.inactiveDays * DAY_MS).toISOString()
			: null,
		labels: match.labels ?? [],
		excludeLabels: match.excludeLabels ?? [],
		skipLocked: match.skipLocked,
		cap: MAX_THREADS_PER_TICK,
	});
	const tickId = scheduleTickId(due.schedule.every, now);
	let events = 0;
	const failures: string[] = [];
	for (const thread of result.threads) {
		const event = scheduledEvent(due, thread, tickId, now);
		try {
			const inserted = await eventServices.insertRawEvent(
				deps.pool,
				deps.boss,
				{
					deliveryId: event.deliveryId,
					rawKind: "schedule.matched",
					raw: event,
					forge: due.forge,
				},
			);
			if (inserted.inserted) {
				events++;
			}
		} catch (error) {
			failures.push(`#${thread.number}: ${getErrorMessage(error)}`);
		}
	}
	const errors = [
		...(result.stopped === "rate-limit"
			? ["rate limited, the rest waits for the next tick"]
			: []),
		...failures,
	];
	return { events, error: errors.length > 0 ? errors.join("; ") : null };
}

export async function scheduleTick(
	deps: ScheduleTickDeps,
): Promise<ScheduleTickResult> {
	const now = deps.now?.() ?? new Date();
	const due = await scheduleServices.listDueSchedules(deps.db, now);
	const result: ScheduleTickResult = {
		schedules: due.length,
		events: 0,
		errors: 0,
	};
	for (const schedule of due) {
		const log = deps.logger.child({
			workflowId: schedule.workflowId,
			nodeId: schedule.nodeId,
			repo: schedule.repoFullName,
		});
		let outcome: { events: number; error: string | null };
		try {
			outcome = await tickOne(deps, schedule, now);
		} catch (error) {
			outcome = { events: 0, error: getErrorMessage(error) };
		}
		result.events += outcome.events;
		if (outcome.error) {
			result.errors++;
			log.warn(
				{ events: outcome.events, error: outcome.error },
				"schedule tick finished with errors",
			);
		} else {
			log.info({ events: outcome.events }, "schedule ticked");
		}
		await scheduleServices.markScheduleTicked(deps.db, {
			workflowRowId: schedule.workflowRowId,
			nodeId: schedule.nodeId,
			at: now,
			error: outcome.error,
		});
	}
	return result;
}
