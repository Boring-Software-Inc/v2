import {
	EMPTY_ONBOARDING_ANSWERS,
	ONBOARDING_STEPS,
	type OnboardingAnswers,
	type OnboardingAnswersPatch,
	type OnboardingStatus,
	type OnboardingStep,
	onboardingAnswersPatchSchema,
	onboardingAnswersSchema,
	onboardingStatusSchema,
	onboardingStepSchema,
} from "@tripwire/contracts";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import { organization } from "../schema/organizations.ts";
import { userOnboarding } from "../schema/user-onboarding.ts";

export interface OnboardingRecord {
	status: OnboardingStatus;
	step: OnboardingStep;
	answers: OnboardingAnswers;
	orgId: string | null;
	repoId: string | null;
}

type OnboardingRow = typeof userOnboarding.$inferSelect;

function readAnswers(value: OnboardingRow["answers"]): OnboardingAnswers {
	const stored = onboardingAnswersPatchSchema.safeParse(value);
	return stored.success
		? { ...EMPTY_ONBOARDING_ANSWERS, ...stored.data }
		: EMPTY_ONBOARDING_ANSWERS;
}

function toRecord(row: OnboardingRow): OnboardingRecord {
	return {
		status: onboardingStatusSchema.catch("in_progress").parse(row.status),
		step: onboardingStepSchema.catch("welcome").parse(row.step),
		answers: readAnswers(row.answers),
		orgId: row.orgId,
		repoId: row.repoId,
	};
}

export async function getOnboarding(
	db: Db,
	userId: string,
): Promise<OnboardingRecord | null> {
	const rows = await db
		.select()
		.from(userOnboarding)
		.where(eq(userOnboarding.userId, userId))
		.limit(1);
	const row = rows[0];
	return row ? toRecord(row) : null;
}

/** A user with no row, or one still in progress, has onboarding to do. */
export async function onboardingRequired(
	db: Db,
	userId: string,
): Promise<boolean> {
	const rows = await db
		.select({ status: userOnboarding.status })
		.from(userOnboarding)
		.where(eq(userOnboarding.userId, userId))
		.limit(1);
	const status = rows[0]?.status;
	return status === undefined || status === "in_progress";
}

/**
 * Records progress for a user still onboarding: the step they reached,
 * answers merged over the stored ones, and the workspace or repo they chose.
 * Returns null once onboarding is completed or skipped, so a stale tab can't
 * reopen it.
 */
export async function saveOnboardingProgress(
	db: Db,
	input: {
		userId: string;
		step?: OnboardingStep;
		answers?: OnboardingAnswersPatch;
		orgId?: string | null;
		repoId?: string | null;
		now?: Date;
	},
): Promise<OnboardingRecord | null> {
	const now = input.now ?? new Date();
	return await db.transaction(async (tx) => {
		await tx
			.insert(userOnboarding)
			.values({ userId: input.userId, startedAt: now, updatedAt: now })
			.onConflictDoNothing();
		const rows = await tx
			.select()
			.from(userOnboarding)
			.where(eq(userOnboarding.userId, input.userId))
			.for("update")
			.limit(1);
		const row = rows[0];
		if (!row || row.status !== "in_progress") {
			return null;
		}
		const current = readAnswers(row.answers);
		const patch = onboardingAnswersPatchSchema.parse(input.answers ?? {});
		const answers = onboardingAnswersSchema.parse({ ...current, ...patch });
		// Progress is the furthest step reached: going back to change an answer
		// and continuing from there never loses it.
		const saved = onboardingStepSchema.catch("welcome").parse(row.step);
		const step =
			input.step &&
			ONBOARDING_STEPS.indexOf(input.step) > ONBOARDING_STEPS.indexOf(saved)
				? input.step
				: saved;
		const updated = await tx
			.update(userOnboarding)
			.set({
				step,
				answers,
				orgId: input.orgId === undefined ? row.orgId : input.orgId,
				repoId: input.repoId === undefined ? row.repoId : input.repoId,
				updatedAt: now,
			})
			.where(eq(userOnboarding.userId, input.userId))
			.returning();
		const next = updated[0];
		return next ? toRecord(next) : null;
	});
}

/** Completing or skipping clears the onboarding requirement for good. */
export async function finishOnboarding(
	db: Db,
	input: {
		userId: string;
		outcome: Exclude<OnboardingStatus, "in_progress">;
		now?: Date;
	},
): Promise<void> {
	const now = input.now ?? new Date();
	const stamp =
		input.outcome === "completed" ? { completedAt: now } : { skippedAt: now };
	await db
		.insert(userOnboarding)
		.values({
			userId: input.userId,
			status: input.outcome,
			startedAt: now,
			updatedAt: now,
			...stamp,
		})
		.onConflictDoUpdate({
			target: userOnboarding.userId,
			set: { status: input.outcome, updatedAt: now, ...stamp },
			setWhere: eq(userOnboarding.status, "in_progress"),
		});
}

export interface StoredChangeRequest {
	number: number;
	title: string;
	author: string;
	openedAt: string;
	closedAt: string | null;
}

const changeRequestRowSchema = z.object({
	subject_number: z.coerce.number().int(),
	title: z.string(),
	author: z.string(),
	opened_at: z.coerce.date(),
	closed_at: z.coerce.date().nullable(),
});

/**
 * Change requests Tripwire already stored for a repo (webhooks plus the
 * backfill that turning the gate on starts), newest activity first. `query`
 * matches the title, or the number when it is all digits.
 */
export async function listStoredChangeRequests(
	db: Db,
	repo: { fullName: string; forge: string },
	options: { query?: string; numbers?: readonly number[]; limit?: number } = {},
): Promise<StoredChangeRequest[]> {
	const query = options.query?.trim() ?? "";
	const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
	const numberMatch = /^#?(\d{1,9})$/.exec(query);
	const textFilter =
		query === ""
			? sql``
			: numberMatch
				? sql`AND subject_number = ${Number(numberMatch[1])}`
				: sql`AND normalized->'changeRequest'->>'title' ILIKE ${`%${query.replace(/[\\%_]/g, "\\$&")}%`}`;
	const numbersFilter =
		options.numbers === undefined
			? sql``
			: options.numbers.length === 0
				? sql`AND false`
				: sql`AND subject_number IN (${sql.join(
						options.numbers.map((n) => sql`${n}`),
						sql`, `,
					)})`;
	const filter = sql`${textFilter} ${numbersFilter}`;
	const result = await db.execute(sql`
		WITH opened AS (
			SELECT DISTINCT ON (subject_number)
				subject_number,
				normalized->'changeRequest'->>'title' AS title,
				normalized->'actor'->>'login' AS author,
				received_at AS opened_at
			FROM events
			WHERE repo_full_name = ${repo.fullName}
			  AND forge = ${repo.forge}
			  AND kind = 'change-request.opened'
			  AND quarantined = false
			  AND normalized IS NOT NULL
			  AND subject_number IS NOT NULL
			  ${filter}
			ORDER BY subject_number, received_at DESC
		)
		SELECT o.subject_number, o.title, o.author, o.opened_at,
		       (SELECT max(e.received_at) FROM events e
		         WHERE e.repo_full_name = ${repo.fullName}
		           AND e.forge = ${repo.forge}
		           AND e.subject_number = o.subject_number
		           AND e.kind = 'change-request.closed'
		           AND e.received_at > o.opened_at) AS closed_at
		FROM opened o
		WHERE o.title IS NOT NULL AND o.author IS NOT NULL
		ORDER BY greatest(o.opened_at, coalesce(
			(SELECT max(e.received_at) FROM events e
			  WHERE e.repo_full_name = ${repo.fullName}
			    AND e.forge = ${repo.forge}
			    AND e.subject_number = o.subject_number
			    AND e.kind = 'change-request.closed'), o.opened_at)) DESC
		LIMIT ${limit}`);
	const changeRequests: StoredChangeRequest[] = [];
	for (const raw of result.rows) {
		const row = changeRequestRowSchema.safeParse(raw);
		if (!row.success) {
			continue;
		}
		changeRequests.push({
			number: row.data.subject_number,
			title: row.data.title,
			author: row.data.author,
			openedAt: row.data.opened_at.toISOString(),
			closedAt: row.data.closed_at?.toISOString() ?? null,
		});
	}
	return changeRequests;
}

/** Whether a workspace slug is already in use, for the live check as it is typed. */
export async function isOrgSlugTaken(db: Db, slug: string): Promise<boolean> {
	const rows = await db
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.slug, slug))
		.limit(1);
	return rows.length > 0;
}

const failedRuleRowSchema = z.object({ rule_id: z.string() });

/**
 * Rules that did not pass on the latest run of each reported change request,
 * most common first. The drafted workflow is built from these.
 */
export async function failedRulesForChangeRequests(
	db: Db,
	repo: { fullName: string; forge: string },
	numbers: readonly number[],
): Promise<string[]> {
	if (numbers.length === 0) {
		return [];
	}
	const result = await db.execute(sql`
		WITH latest AS (
			SELECT DISTINCT ON (r.subject_number) r.id
			FROM runs r
			JOIN events e ON e.id = r.event_id AND e.forge = ${repo.forge}
			WHERE r.repo_full_name = ${repo.fullName}
			  AND r.subject_kind IS NULL
			  AND r.subject_number IN (${sql.join(
					numbers.map((n) => sql`${n}`),
					sql`, `,
				)})
			ORDER BY r.subject_number, r.created_at DESC
		)
		SELECT split_part(s.rule_id, '@', 1) AS rule_id
		FROM run_steps s
		JOIN latest l ON l.id = s.run_id
		WHERE s.node_kind = 'rule'
		  AND s.rule_id IS NOT NULL
		  AND s.status = 'fail'
		GROUP BY 1
		ORDER BY count(*) DESC, 1`);
	const ruleIds: string[] = [];
	for (const raw of result.rows) {
		const row = failedRuleRowSchema.safeParse(raw);
		if (row.success) {
			ruleIds.push(row.data.rule_id);
		}
	}
	return ruleIds;
}
