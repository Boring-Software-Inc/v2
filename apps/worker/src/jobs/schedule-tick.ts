import {
	durationMs,
	type Forge,
	type GitCafeRepositoryBinding,
	type ScheduledEvent,
	scheduleFireTime,
	scheduleTickSlot,
} from "@tripwire/contracts";
import type { Db, DueSchedule } from "@tripwire/db";
import {
	eventServices,
	gitCafeLifecycleServices,
	repoServices,
	scheduleServices,
} from "@tripwire/db";
import type { ForgeThread } from "@tripwire/forge";
import { generateId, getErrorMessage } from "@tripwire/utils";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type { ForgeRuntime } from "../forge-runtime.ts";

export const SCHEDULE_TICK_QUEUE = "schedule-tick";
export const SCHEDULE_TICK_CRON = "*/5 * * * *";
export const MAX_THREADS_PER_TICK = 100;

export interface ScheduleTickDeps {
	db: Db;
	pool: Pool;
	boss: PgBoss;
	resolveForge: (forge: Forge) => ForgeRuntime | null;
	logger: Logger;
	now?: () => Date;
	forge?: Forge;
	requestId?: string;
}

export interface ScheduleTickResult {
	schedules: number;
	events: number;
	errors: number;
}

export function scheduleTickId(
	due: Pick<DueSchedule, "schedule" | "lastTickAt">,
	now: Date,
): string {
	return (
		scheduleFireTime(due.schedule, due.lastTickAt, now) ?? now
	).toISOString();
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
	let binding: GitCafeRepositoryBinding | undefined;
	if (due.forge === "gitcafe") {
		const repo = await repoServices.getRepoById(deps.db, due.repoId);
		if (
			!repo?.orgId ||
			!repo.installationId ||
			repo.forge !== "gitcafe" ||
			repo.fullName !== due.repoFullName ||
			repo.externalId !== due.repoExternalId ||
			repo.installationId !== due.installationId ||
			!repo.armed ||
			repo.removedAt
		)
			return { events: 0, error: "GitCafe scheduled authority unavailable" };
		const authority = await gitCafeLifecycleServices.getGitCafeActionAuthority(
			deps.db,
			repo.installationId,
		);
		if (!authority.allowed)
			return { events: 0, error: "GitCafe scheduled authority unavailable" };
		binding = {
			repoId: repo.id,
			organizationId: repo.orgId,
			installationId: repo.installationId,
			repositoryId: repo.externalId,
			fullName: repo.fullName,
			generation: authority.generation,
		};
	}
	const listed = await listThreads(due.repoFullName, {
		subjects: match.subjects,
		state: match.state,
		updatedBefore: new Date(
			now.getTime() - durationMs(match.inactiveFor),
		).toISOString(),
		labels: match.labels ?? [],
		excludeLabels: match.excludeLabels ?? [],
		skipLocked: match.skipLocked,
		cap: MAX_THREADS_PER_TICK,
	});
	if ("ok" in listed && !listed.ok) {
		return { events: 0, error: `thread listing unavailable: ${listed.reason}` };
	}
	const result = "ok" in listed ? listed.value : listed;
	const tickId = scheduleTickId(due, now);
	let events = 0;
	const failures: string[] = [];
	for (const thread of result.threads) {
		const event = scheduledEvent(due, thread, tickId, now);
		try {
			if (binding) {
				const inserted =
					await gitCafeLifecycleServices.insertGitCafeScheduledEvent(
						deps.db,
						deps.boss,
						{
							event: {
								...event,
								deliveryId: `${event.deliveryId}:${thread.kind}`,
							},
							binding,
							requestId: deps.requestId ?? generateId(),
						},
					);
				if (!inserted.ok) failures.push("GitCafe scheduled authority changed");
				else if (inserted.inserted) events++;
				continue;
			}
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
	const due = await scheduleServices.listDueSchedules(deps.db, now, deps.forge);
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
		if (outcome.error) {
			await scheduleServices.markScheduleFailed(deps.db, {
				workflowRowId: schedule.workflowRowId,
				nodeId: schedule.nodeId,
				error: outcome.error,
			});
		} else {
			await scheduleServices.markScheduleTicked(deps.db, {
				workflowRowId: schedule.workflowRowId,
				nodeId: schedule.nodeId,
				at: scheduleTickSlot(now),
				error: null,
			});
		}
	}
	return result;
}
