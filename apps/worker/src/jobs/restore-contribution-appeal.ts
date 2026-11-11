import {
	appealRestorationGuardSchema,
	appealRestorationPullSchema,
	appealRestorationThreadSchema,
	normalizedEventSchema,
	type RestoreContributionAppealJob,
	STANDALONE_MODERATION_NODE_ID,
	storedActionPayloadSchema,
	VERDICT_EVENT_KINDS,
} from "@tripwire/contracts";
import { eventServices, repoServices, runServices, schema } from "@tripwire/db";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { buildCommentReasons } from "./comment-reasons.ts";
import { customRuleSource } from "./custom-rules.ts";
import { emitPrSurface, toForgeAction } from "./pr-surface.ts";
import type { ProcessEventDeps } from "./process-event.ts";
import { resumeRun } from "./resume-run.ts";

export async function restoreContributionAppeal(
	deps: ProcessEventDeps,
	{ appealId }: RestoreContributionAppealJob,
): Promise<void> {
	const { db } = deps;
	const [appeal] = await db
		.select()
		.from(schema.contributionAppeals)
		.where(eq(schema.contributionAppeals.id, appealId));
	if (!appeal || !["approve-once", "approve-author"].includes(appeal.status))
		return;
	const [repo] = await db
		.select()
		.from(schema.repos)
		.where(eq(schema.repos.id, appeal.repoId));
	const data = await runServices.getRunWithSteps(db, appeal.runId);
	if (
		!repo ||
		repo.forge !== "github" ||
		repo.removedAt ||
		!data ||
		!data.steps.some((step) => step.nodeId === STANDALONE_MODERATION_NODE_ID)
	)
		return;
	const eventRow = await eventServices.getEventById(db, data.run.eventId);
	const parsed = normalizedEventSchema.safeParse(eventRow?.normalized);
	if (!parsed.success || !("repoExternalId" in parsed.data)) return;
	const event = parsed.data;
	const subject =
		event.kind === "issue.opened"
			? event.issue
			: "changeRequest" in event
				? event.changeRequest
				: null;
	if (
		!subject ||
		repo.externalId !== event.repoExternalId ||
		repo.fullName !== event.repo.fullName ||
		appeal.subjectNumber !== subject.number ||
		appeal.accountId !== event.actor.externalId ||
		(event.kind === "issue.opened" ? "issue" : "change-request") !==
			appeal.subjectKind
	)
		return;
	const latest = async () => {
		const [row] = await db
			.select({ id: schema.runs.id })
			.from(schema.runs)
			.innerJoin(schema.events, eq(schema.events.id, schema.runs.eventId))
			.where(
				and(
					eq(schema.runs.repoFullName, repo.fullName),
					eq(schema.events.forge, repo.forge),
					eq(schema.runs.subjectNumber, appeal.subjectNumber),
					appeal.subjectKind === "issue"
						? eq(schema.events.kind, "issue.opened")
						: or(
								eq(schema.runs.subjectKind, "change-request"),
								and(
									isNull(schema.runs.subjectKind),
									inArray(schema.events.kind, VERDICT_EVENT_KINDS),
								),
							),
					ne(schema.runs.status, "failed"),
					eq(schema.runs.backfill, false),
				),
			)
			.orderBy(
				desc(schema.runs.eventId),
				desc(schema.runs.createdAt),
				desc(schema.runs.id),
			)
			.limit(1);
		return row?.id === data.run.id;
	};
	if (!(await latest())) return;
	const runtime = deps.resolveForge("github");
	if (!runtime?.adapter || !runtime.signalHttp)
		throw new Error("Appeal restoration requires the GitHub runtime");
	const live = appealRestorationThreadSchema.parse(
		await runtime.signalHttp.get(
			repo.fullName,
			`/repos/${repo.fullName}/issues/${subject.number}`,
		),
	);
	if (
		String(live.user.id) !== appeal.accountId ||
		(live.pull_request !== undefined) !==
			(appeal.subjectKind === "change-request")
	)
		return;
	if ("changeRequest" in event) {
		const pull = appealRestorationPullSchema.parse(
			await runtime.signalHttp.get(
				repo.fullName,
				`/repos/${repo.fullName}/pulls/${subject.number}`,
			),
		);
		if (pull.merged || pull.head.sha !== data.run.headSha) return;
	}
	const standalone = data.actions.filter(
		(action) =>
			storedActionPayloadSchema.parse(action.payload).nodeId ===
			STANDALONE_MODERATION_NODE_ID,
	);
	const ownIds = standalone.map((action) => action.id);
	const restore = standalone.filter(
		(action) =>
			action.executedAt &&
			["close", "lock"].includes(action.kind) &&
			!data.actions.some(
				(other) =>
					other.kind === action.kind &&
					!ownIds.includes(other.id) &&
					!["suppressed", "superseded"].includes(other.status),
			),
	);
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT id FROM runs WHERE id = ${data.run.id} FOR UPDATE`,
		);
		if (ownIds.length)
			await tx
				.update(schema.runActions)
				.set({ status: "suppressed" })
				.where(inArray(schema.runActions.id, ownIds));
		const auditNode = `${STANDALONE_MODERATION_NODE_ID}:appeal:${appealId}`;
		const [audit] = await tx
			.select({ id: schema.runSteps.id })
			.from(schema.runSteps)
			.where(
				and(
					eq(schema.runSteps.runId, data.run.id),
					eq(schema.runSteps.nodeId, auditNode),
				),
			);
		if (!audit) {
			const at = new Date().toISOString();
			await runServices.recordSteps(tx, data.run.id, [
				{
					nodeId: auditNode,
					nodeKind: "action",
					status: "approved",
					input: { appealId },
					output: { decision: appeal.status },
					startedAt: at,
					finishedAt: at,
					durationMs: 0,
				},
			]);
		}
		for (const action of restore) {
			const guard = appealRestorationGuardSchema.parse({
				authorId: appeal.accountId,
				subject: appeal.subjectKind,
				appliedAfter: action.recordedAt.toISOString(),
				appliedBefore: action.executedAt?.toISOString(),
			});
			if (data.run.headSha) guard.headSha = data.run.headSha;
			await runServices.recordActions(tx, data.run.id, [
				{
					kind: action.kind === "close" ? "reopen" : "unlock",
					payload: guard,
					idempotencyKey: `appeal:${appealId}:restore:${action.id}`,
				},
			]);
		}
	});
	const [item] = await db
		.select()
		.from(schema.moderationItems)
		.where(
			and(
				eq(schema.moderationItems.runId, data.run.id),
				eq(schema.moderationItems.nodeId, STANDALONE_MODERATION_NODE_ID),
			),
		);
	if (item && (item.status === "pending" || item.status === "denied"))
		await db
			.update(schema.moderationItems)
			.set({
				status: "approved",
				decidedAt: new Date(),
				decidedBy: appeal.decidedBy,
			})
			.where(
				and(
					eq(schema.moderationItems.id, item.id),
					inArray(schema.moderationItems.status, ["pending", "denied"]),
				),
			);
	if (item && !item.appliedAt) {
		await resumeRun(deps, { itemId: item.id, decision: "approve" });
	}
	const settled = await runServices.settleRun(db, data.run.id, null);
	const pending = (
		await db
			.select()
			.from(schema.runActions)
			.where(eq(schema.runActions.runId, data.run.id))
	).filter(
		(action) =>
			action.status === "recorded" &&
			action.idempotencyKey.startsWith(`appeal:${appealId}:restore:`),
	);
	for (const action of pending) {
		if (!(await latest())) {
			await runServices.markActionSuperseded(db, action.id);
			continue;
		}
		const result = await runtime.adapter.execute(
			toForgeAction(
				{ ...action, payload: storedActionPayloadSchema.parse(action.payload) },
				repo.fullName,
				subject.number,
				"",
			),
			{ actionId: action.id },
		);
		if ("refused" in result) {
			deps.logger.warn(
				{ appealId, actionId: action.id, reason: result.reason },
				"Appeal restoration refused",
			);
			await runServices.markActionSuperseded(db, action.id);
		} else {
			await runServices.markActionExecuted(db, action.id, result.externalId);
		}
	}
	if (!(await latest())) return;
	const [waiver] = await db
		.select({ id: schema.runSteps.id })
		.from(schema.runSteps)
		.where(
			and(
				eq(schema.runSteps.runId, data.run.id),
				eq(schema.runSteps.nodeId, `${STANDALONE_MODERATION_NODE_ID}:resume`),
				sql`${schema.runSteps.output} ->> 'waived' = 'true'`,
			),
		);
	if (!waiver) {
		const at = new Date().toISOString();
		await runServices.recordSteps(db, data.run.id, [
			{
				nodeId: `${STANDALONE_MODERATION_NODE_ID}:resume`,
				nodeKind: "action",
				status: "skipped",
				input: { appealId },
				output: { waived: true, appealId },
				startedAt: at,
				finishedAt: at,
				durationMs: 0,
			},
		]);
	}
	const surfaceRows = (
		await db
			.select()
			.from(schema.runActions)
			.where(eq(schema.runActions.runId, data.run.id))
	)
		.filter(
			(action) =>
				action.status === "recorded" &&
				action.idempotencyKey.includes(`appeal:${appealId}`) &&
				action.kind !== "reopen" &&
				action.kind !== "unlock",
		)
		.map((action) => ({
			...action,
			payload: storedActionPayloadSchema.parse(action.payload),
		}));
	const customRecords = customRuleSource(
		await repoServices.listCustomRules(db, repo.id),
		null,
	).records;
	await emitPrSurface(
		{ db, adapter: runtime.adapter, logger: deps.logger, appUrl: deps.appUrl },
		{
			event,
			runId: data.run.id,
			verdict: settled.verdict,
			reasons: buildCommentReasons(data.steps, customRecords),
			resumedFrom:
				data.run.verdict === "needs_review"
					? "needs_review"
					: data.run.verdict === "close"
						? "close"
						: "block",
			surfaceKey: `appeal:${appealId}`,
			pendingCheckPosted: "changeRequest" in event,
			pendingActionRows: surfaceRows,
		},
	);
	const outstanding = await db
		.select()
		.from(schema.runActions)
		.where(eq(schema.runActions.runId, data.run.id));
	if (
		outstanding.some(
			(action) =>
				action.status === "recorded" &&
				(action.idempotencyKey.includes(`appeal:${appealId}`) ||
					action.kind === "dismiss-review"),
		)
	)
		throw new Error("Appeal restoration surfaces are still pending");
}
