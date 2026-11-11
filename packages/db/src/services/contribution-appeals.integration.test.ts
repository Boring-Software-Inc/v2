import { afterAll, beforeAll, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, normalizedEventSchema } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../client.ts";
import { applyMigrations } from "../migrate.ts";
import {
	account,
	contributionAppeals,
	events,
	organization,
	repos,
	runSteps,
	runs,
	user,
} from "../schema/index.ts";
import { createTestDatabase, type TestDatabase } from "../testing.ts";
import {
	decideAppeal,
	getApprovedAppealId,
	getOwnAppeal,
	listPendingAppeals,
	submitAppeal,
} from "./contribution-appeals.ts";
import { addAllowlistEntry, isAuthorAllowlisted } from "./moderation-policy.ts";

let container: TestDatabase;
let db: Db;
let close: () => Promise<void>;
const orgId = generateId();
const authorId = generateId();
const outsiderId = generateId();
const reviewerId = generateId();

beforeAll(async () => {
	container = await createTestDatabase();
	const connection = createDb(container.url);
	db = connection.db;
	close = () => connection.pool.end();
	await applyMigrations(db);
	await db
		.insert(organization)
		.values({ id: orgId, name: "Appeals", slug: "appeals" });
	await db.insert(user).values([
		{ id: authorId, name: "Contributor", email: `${authorId}@example.test` },
		{
			id: outsiderId,
			name: "Other account",
			email: `${outsiderId}@example.test`,
		},
		{ id: reviewerId, name: "Maintainer", email: `${reviewerId}@example.test` },
	]);
}, 120_000);

afterAll(async () => {
	await close?.();
	await container?.stop();
});

async function seedSubject(withPolicyOutcome = true) {
	const captured = await Bun.file(
		new URL(
			"../../../core/fixtures/change-request.opened.event.json",
			import.meta.url,
		),
	).json();
	const event = normalizedEventSchema.parse(captured);
	if (event.kind !== "change-request.opened")
		throw new Error("Expected captured change request");
	const repoId = generateId();
	const name = `appeal-${repoId}`;
	const fullName = `appeals/${name}`;
	const externalId = generateId();
	const runId = generateId();
	const eventId = generateId();
	await db.insert(repos).values({
		id: repoId,
		orgId,
		externalId,
		name,
		owner: "appeals",
		fullName,
	});
	await db
		.insert(account)
		.values({
			id: generateId(),
			userId: authorId,
			providerId: "github",
			accountId: event.actor.externalId,
		})
		.onConflictDoNothing();
	await db.insert(events).values({
		id: eventId,
		deliveryId: eventId,
		forge: "github",
		rawKind: "pull_request",
		raw: captured,
		normalized: {
			...event,
			repoFullName: fullName,
			repoExternalId: externalId,
		},
	});
	await db.insert(runs).values({
		id: runId,
		eventId,
		repoFullName: fullName,
		subjectNumber: event.changeRequest.number,
		subjectKind: "change-request",
		headSha: event.changeRequest.headSha,
		status: "completed",
		verdict: "block",
		workflowSnapshot: [DEFAULT_WORKFLOW],
	});
	if (withPolicyOutcome) {
		await db.insert(runSteps).values({
			id: generateId(),
			runId,
			nodeId: `${DEFAULT_WORKFLOW.id}:moderation-outcome`,
			nodeKind: "action",
			status: "ran",
			startedAt: new Date(),
			finishedAt: new Date(),
			durationMs: 0,
		});
	}
	return {
		repoId,
		runId,
		subjectKind: "change-request" as const,
		subjectNumber: event.changeRequest.number,
		accountId: event.actor.externalId,
	};
}

test("only the original GitHub author can access and submit a policy appeal", async () => {
	const subject = await seedSubject();
	expect(await getOwnAppeal(db, subject.runId, outsiderId)).toBeNull();
	expect(
		await submitAppeal(db, {
			runId: subject.runId,
			userId: outsiderId,
			reason: "Please review",
		}),
	).toBeNull();
	expect(await getOwnAppeal(db, subject.runId, authorId)).toEqual({
		status: null,
	});
	expect(
		await submitAppeal(db, {
			runId: subject.runId,
			userId: authorId,
			reason: "  Please review  ",
		}),
	).toEqual({ status: "pending" });
	const rows = await listPendingAppeals(db, subject.repoId);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.reason).toBe("Please review");
});

test("workflow comments and arbitrary runs do not create an appeal entitlement", async () => {
	const subject = await seedSubject(false);
	expect(await getOwnAppeal(db, subject.runId, authorId)).toBeNull();
});

test("parallel submissions preserve the original reason and create one appeal", async () => {
	const subject = await seedSubject();
	await Promise.all([
		submitAppeal(db, {
			runId: subject.runId,
			userId: authorId,
			reason: "First submission",
		}),
		submitAppeal(db, {
			runId: subject.runId,
			userId: authorId,
			reason: "Second submission",
		}),
	]);
	expect(await listPendingAppeals(db, subject.repoId)).toHaveLength(1);
});

test("an approval is scoped to its repository, author, contribution, and subject kind", async () => {
	const subject = await seedSubject();
	await submitAppeal(db, {
		runId: subject.runId,
		userId: authorId,
		reason: "Review this",
	});
	const [appeal] = await listPendingAppeals(db, subject.repoId);
	if (!appeal) throw new Error("Missing appeal");
	const input = {
		repoId: subject.repoId,
		appealId: appeal.id,
		decidedBy: reviewerId,
		decision: "approve-once" as const,
	};
	expect(
		await decideAppeal(db, { ...input, repoId: generateId() }, async () => {}),
	).toBe(false);
	expect(await getApprovedAppealId(db, subject)).toBeNull();
	expect(await decideAppeal(db, input, async () => {})).toBe(true);
	expect(await getApprovedAppealId(db, subject)).toBe(appeal.id);
	expect(
		await getApprovedAppealId(db, { ...subject, subjectKind: "issue" }),
	).toBeNull();
	expect(
		await getApprovedAppealId(db, { ...subject, accountId: "different" }),
	).toBeNull();
	expect(
		await getApprovedAppealId(db, {
			...subject,
			subjectNumber: subject.subjectNumber + 1,
		}),
	).toBeNull();
	expect(
		await getApprovedAppealId(db, { ...subject, repoId: generateId() }),
	).toBeNull();
	expect(
		await decideAppeal(db, { ...input, decision: "deny" }, async () => {}),
	).toBe(false);
});

test("approve-author adds the stable GitHub identity atomically", async () => {
	const subject = await seedSubject();
	await submitAppeal(db, {
		runId: subject.runId,
		userId: authorId,
		reason: "Review this",
	});
	const [appeal] = await listPendingAppeals(db, subject.repoId);
	if (!appeal) throw new Error("Missing appeal");
	expect(
		await decideAppeal(
			db,
			{
				repoId: subject.repoId,
				appealId: appeal.id,
				decidedBy: reviewerId,
				decision: "approve-author",
			},
			async (tx, row) => {
				await addAllowlistEntry(tx, row.repoId, {
					accountId: row.accountId,
					login: row.login,
				});
			},
		),
	).toBe(true);
	expect(await isAuthorAllowlisted(db, subject.repoId, subject.accountId)).toBe(
		true,
	);
});

test("a failed approval effect rolls back its decision", async () => {
	const subject = await seedSubject();
	await submitAppeal(db, {
		runId: subject.runId,
		userId: authorId,
		reason: "Review this",
	});
	const [appeal] = await listPendingAppeals(db, subject.repoId);
	if (!appeal) throw new Error("Missing appeal");
	await expect(
		decideAppeal(
			db,
			{
				repoId: subject.repoId,
				appealId: appeal.id,
				decidedBy: reviewerId,
				decision: "approve-once",
			},
			async () => {
				throw new Error("Unavailable");
			},
		),
	).rejects.toThrow("Unavailable");
	expect(await getOwnAppeal(db, subject.runId, authorId)).toEqual({
		status: "pending",
	});
	expect(await getApprovedAppealId(db, subject)).toBeNull();
});

test("denial records the decision without granting an approval", async () => {
	const subject = await seedSubject();
	await submitAppeal(db, {
		runId: subject.runId,
		userId: authorId,
		reason: "Review this",
	});
	const [appeal] = await listPendingAppeals(db, subject.repoId);
	if (!appeal) throw new Error("Missing appeal");
	await decideAppeal(
		db,
		{
			repoId: subject.repoId,
			appealId: appeal.id,
			decidedBy: reviewerId,
			decision: "deny",
		},
		async () => {
			throw new Error("Denial must not invoke approval effects");
		},
	);
	expect(await getApprovedAppealId(db, subject)).toBeNull();
	const [row] = await db
		.select()
		.from(contributionAppeals)
		.where(eq(contributionAppeals.id, appeal.id));
	expect(row?.decidedBy).toBe(reviewerId);
	expect(row?.status).toBe("deny");
});

test("empty reasons are rejected before persisting", async () => {
	const subject = await seedSubject();
	await expect(
		submitAppeal(db, { runId: subject.runId, userId: authorId, reason: "  " }),
	).rejects.toThrow();
	expect(await listPendingAppeals(db, subject.repoId)).toHaveLength(0);
});
