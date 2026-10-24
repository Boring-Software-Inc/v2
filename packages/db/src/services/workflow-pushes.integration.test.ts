import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { user } from "../schema/auth.ts";
import { organization } from "../schema/organizations.ts";
import { repos, workflowDefinitions } from "../schema/repos.ts";
import { workflowPushProposals } from "../schema/workflow-pushes.ts";
import {
	decideWorkflowPush,
	definitionHash,
	getWorkflowPush,
	proposeWorkflowPush,
	reviewWorkflowPush,
} from "./workflow-pushes.ts";
import {
	createWorkflow,
	getWorkflow,
	listWorkflowRows,
	saveWorkflowDefinition,
	setWorkflowEnabled,
} from "./workflows.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
const orgId = generateId();
const otherOrgId = generateId();
const authorId = generateId();
const reviewerId = generateId();

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	await db.insert(user).values([
		{ id: authorId, name: "Ada", email: "ada@example.com" },
		{ id: reviewerId, name: "Grace", email: "grace@example.com" },
	]);
	await db.insert(organization).values([
		{ id: orgId, name: "acme", slug: "acme", isPersonal: false },
		{ id: otherOrgId, name: "other", slug: "other", isPersonal: false },
	]);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function newRepo(): Promise<string> {
	const id = generateId();
	await db.insert(repos).values({
		id,
		externalId: id,
		owner: "acme",
		name: `api-${id.slice(-6)}`,
		fullName: `acme/api-${id.slice(-6)}`,
		orgId,
	});
	return id;
}

function gate(id: string, name: string, minDays = 7): WorkflowDefinition {
	return {
		id,
		name,
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: ["change-request.opened"],
				position: { x: 0, y: 0 },
			},
			{
				id: "r",
				type: "rule",
				ref: "account-age@1",
				config: { minDays },
				position: { x: 260, y: 0 },
			},
			{ id: "a", type: "action", action: "block", position: { x: 520, y: 0 } },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	};
}

function broken(id: string, name: string): WorkflowDefinition {
	const base = gate(id, name);
	return {
		...base,
		nodes: base.nodes.filter((node) => node.id !== "a"),
		edges: base.edges.filter((edge) => edge.id !== "e2"),
	};
}

async function seeded(repoId: string, definition: WorkflowDefinition) {
	return await createWorkflow(db, {
		repoId,
		name: definition.name,
		definition,
	});
}

async function propose(repoId: string, definitions: WorkflowDefinition[]) {
	const result = await proposeWorkflowPush(db, {
		orgId,
		repoId,
		authorId,
		definitions,
	});
	if (!(result.ok && result.kind === "proposed")) {
		throw new Error(`expected a proposal, got ${JSON.stringify(result)}`);
	}
	return result.push;
}

describe("propose", () => {
	test("stores changed and new workflows with their bases, pending for an hour", async () => {
		const repoId = await newRepo();
		const saved = await seeded(repoId, gate("gate", "Gate"));
		const now = new Date("2026-10-24T12:00:00Z");
		const result = await proposeWorkflowPush(db, {
			orgId,
			repoId,
			authorId,
			definitions: [gate("gate", "Gate", 30), gate("fresh", "Fresh")],
			now,
		});
		if (!(result.ok && result.kind === "proposed")) {
			throw new Error("expected a proposal");
		}
		const { push } = result;
		expect(push.status).toBe("pending");
		const live = await getWorkflowPush(db, {
			orgId,
			pushId: push.id,
			now: new Date("2026-10-24T12:30:00Z"),
		});
		expect(live?.status).toBe("pending");
		expect(push.expiresAt.toISOString()).toBe("2026-10-24T13:00:00.000Z");
		expect(push.authorName).toBe("Ada");
		const stored = await getWorkflow(db, { repoId, workflowId: saved.id });
		expect(push.entries).toEqual([
			{
				definition: gate("gate", "Gate", 30),
				baseWorkflowId: saved.id,
				baseHash: definitionHash(stored?.definition ?? gate("x", "x")),
				baseDefinition: stored?.definition ?? null,
				draft: null,
			},
			{
				definition: gate("fresh", "Fresh"),
				baseWorkflowId: null,
				baseHash: null,
				baseDefinition: null,
				draft: null,
			},
		]);
	});

	test("leaves out workflows that did not change", async () => {
		const repoId = await newRepo();
		await seeded(repoId, gate("gate", "Gate"));
		const push = await propose(repoId, [
			gate("gate", "Gate"),
			gate("other", "Other"),
		]);
		expect(push.entries.map((entry) => entry.definition.id)).toEqual(["other"]);
	});

	test("says unchanged when nothing differs", async () => {
		const repoId = await newRepo();
		await seeded(repoId, gate("gate", "Gate"));
		expect(
			await proposeWorkflowPush(db, {
				orgId,
				repoId,
				authorId,
				definitions: [gate("gate", "Gate")],
			}),
		).toEqual({ ok: true, kind: "unchanged" });
	});

	test("refuses errors on a workflow that is on, and names them", async () => {
		const repoId = await newRepo();
		const saved = await seeded(repoId, gate("half", "Half"));
		await setWorkflowEnabled(db, {
			repoId,
			workflowId: saved.id,
			enabled: true,
		});
		const result = await proposeWorkflowPush(db, {
			orgId,
			repoId,
			authorId,
			definitions: [broken("half", "Half")],
		});
		expect(result).toEqual({
			ok: false,
			reason: "blocked",
			blocks: [
				{
					id: "half",
					name: "Half",
					issues: [expect.stringContaining("Add an action")],
				},
			],
		});
		const left = await db
			.select()
			.from(workflowPushProposals)
			.where(eq(workflowPushProposals.repoId, repoId));
		expect(left).toHaveLength(0);
	});

	test("takes a draft with errors when the workflow is off, as apply does", async () => {
		const repoId = await newRepo();
		const push = await propose(repoId, [broken("half", "Half")]);
		const review = await reviewWorkflowPush(db, {
			orgId,
			repoId,
			pushId: push.id,
		});
		expect(review?.blocked).toBe(false);
		expect(
			review?.workflows[0]?.issues.some((issue) => issue.severity === "error"),
		).toBe(true);
	});

	test("the review hides rules the repo lacks while the workflow is off", async () => {
		const repoId = await newRepo();
		const base = gate("missing", "Missing");
		const push = await propose(repoId, [
			{
				...base,
				nodes: base.nodes.map((node) =>
					node.type === "rule" ? { ...node, ref: "custom-gone@1" } : node,
				),
			},
		]);
		const review = await reviewWorkflowPush(db, {
			orgId,
			repoId,
			pushId: push.id,
		});
		expect(
			review?.workflows[0]?.issues.map((issue) => issue.rule),
		).not.toContain("rule-unavailable");
	});

	test("refuses a name another workflow holds", async () => {
		const repoId = await newRepo();
		await seeded(repoId, gate("gate", "Gate"));
		const result = await proposeWorkflowPush(db, {
			orgId,
			repoId,
			authorId,
			definitions: [gate("second", "Gate")],
		});
		expect(result.ok).toBe(false);
	});

	test("never stores a delivery secret", async () => {
		const repoId = await newRepo();
		const withHook: WorkflowDefinition = {
			...gate("hook", "Hook"),
			nodes: [
				...gate("hook", "Hook").nodes,
				{
					id: "w",
					type: "action",
					action: "webhook",
					params: { url: "https://example.com/hook", signingSecret: "s3cret" },
					position: { x: 780, y: 0 },
				},
			],
			edges: [
				...gate("hook", "Hook").edges,
				{ id: "e3", from: "r", to: "w", when: "fail" },
			],
		};
		const push = await propose(repoId, [withHook]);
		const raw = await db
			.select({ entries: workflowPushProposals.entries })
			.from(workflowPushProposals)
			.where(eq(workflowPushProposals.id, push.id));
		expect(JSON.stringify(raw)).not.toContain("s3cret");
		expect(JSON.stringify(raw)).not.toContain("example.com/hook");
	});
});

describe("read", () => {
	test("another org cannot see the push", async () => {
		const repoId = await newRepo();
		const push = await propose(repoId, [gate("gate", "Gate")]);
		expect(
			await getWorkflowPush(db, { orgId: otherOrgId, pushId: push.id }),
		).toBeNull();
		expect(
			await reviewWorkflowPush(db, {
				orgId: otherOrgId,
				repoId,
				pushId: push.id,
			}),
		).toBeNull();
	});

	test("the review is scoped to the push's repo", async () => {
		const repoId = await newRepo();
		const elsewhere = await newRepo();
		const push = await propose(repoId, [gate("gate", "Gate")]);
		expect(
			await reviewWorkflowPush(db, {
				orgId,
				repoId: elsewhere,
				pushId: push.id,
			}),
		).toBeNull();
	});

	test("the review holds both sides, with secrets blanked", async () => {
		const repoId = await newRepo();
		await seeded(repoId, gate("gate", "Gate"));
		const push = await propose(repoId, [
			gate("gate", "Gate", 30),
			gate("fresh", "Fresh"),
		]);
		const review = await reviewWorkflowPush(db, {
			orgId,
			repoId,
			pushId: push.id,
		});
		expect(review?.blocked).toBe(false);
		expect(review?.workflows.map((entry) => [entry.id, entry.change])).toEqual([
			["gate", "changed"],
			["fresh", "new"],
		]);
		expect(review?.workflows[0]?.before?.nodes[1]).toMatchObject({
			config: { minDays: 7 },
		});
		expect(review?.workflows[0]?.after.nodes[1]).toMatchObject({
			config: { minDays: 30 },
		});
		expect(review?.workflows[1]?.before).toBeNull();
	});

	test("an edit in the editor makes the push read as stale", async () => {
		const repoId = await newRepo();
		const saved = await seeded(repoId, gate("gate", "Gate"));
		const push = await propose(repoId, [gate("gate", "Gate", 30)]);
		await saveWorkflowDefinition(db, {
			repoId,
			workflowId: saved.id,
			definition: gate("gate", "Gate", 14),
		});
		const read = await getWorkflowPush(db, { orgId, pushId: push.id });
		expect(read?.status).toBe("stale");
		const review = await reviewWorkflowPush(db, {
			orgId,
			repoId,
			pushId: push.id,
		});
		expect(review?.workflows[0]?.stale).toBe(true);
	});
});

describe("decide", () => {
	test("accept applies every workflow at once and records who", async () => {
		const repoId = await newRepo();
		const saved = await seeded(repoId, gate("gate", "Gate"));
		const push = await propose(repoId, [
			gate("gate", "Gate", 30),
			gate("fresh", "Fresh"),
		]);
		const result = await decideWorkflowPush(db, {
			orgId,
			pushId: push.id,
			userId: reviewerId,
			decision: "accept",
		});
		expect(result).toMatchObject({
			ok: true,
			status: "accepted",
			outcomes: [
				{ id: "gate", outcome: "updated", workflowId: saved.id },
				{ id: "fresh", outcome: "created" },
			],
		});
		const rows = await listWorkflowRows(db, repoId);
		expect(rows.map((row) => [row.definition.id, row.enabled])).toEqual([
			["gate", false],
			["fresh", false],
		]);
		expect(rows[0]?.definition.nodes[1]).toMatchObject({
			config: { minDays: 30 },
		});
		const read = await getWorkflowPush(db, { orgId, pushId: push.id });
		expect(read?.status).toBe("accepted");
		expect(read?.decidedByName).toBe("Grace");
		expect(read?.outcomes).toHaveLength(2);
	});

	test("a decided push still shows the diff it was accepted with", async () => {
		const repoId = await newRepo();
		await seeded(repoId, gate("gate", "Gate"));
		const push = await propose(repoId, [gate("gate", "Gate", 30)]);
		await decideWorkflowPush(db, {
			orgId,
			pushId: push.id,
			userId: reviewerId,
			decision: "accept",
		});
		const review = await reviewWorkflowPush(db, {
			orgId,
			repoId,
			pushId: push.id,
		});
		expect(review?.status).toBe("accepted");
		expect(review?.workflows[0]?.stale).toBe(false);
		expect(review?.workflows[0]?.before?.nodes[1]).toMatchObject({
			config: { minDays: 7 },
		});
		expect(review?.workflows[0]?.after.nodes[1]).toMatchObject({
			config: { minDays: 30 },
		});
	});

	test("the stored base keeps no secret of the saved workflow", async () => {
		const repoId = await newRepo();
		const hooked: WorkflowDefinition = {
			...gate("hooked", "Hooked"),
			nodes: [
				...gate("hooked", "Hooked").nodes,
				{
					id: "w",
					type: "action",
					action: "webhook",
					params: { url: "https://saved.example/hook", signingSecret: "k3y" },
					position: { x: 780, y: 0 },
				},
			],
			edges: [
				...gate("hooked", "Hooked").edges,
				{ id: "e3", from: "r", to: "w", when: "fail" },
			],
		};
		await seeded(repoId, hooked);
		const push = await propose(repoId, [
			{
				...hooked,
				nodes: hooked.nodes.map((node) =>
					node.type === "rule" ? { ...node, config: { minDays: 30 } } : node,
				),
			},
		]);
		const raw = await db
			.select({ entries: workflowPushProposals.entries })
			.from(workflowPushProposals)
			.where(eq(workflowPushProposals.id, push.id));
		expect(JSON.stringify(raw)).not.toContain("saved.example");
		expect(JSON.stringify(raw)).not.toContain("k3y");
		const result = await decideWorkflowPush(db, {
			orgId,
			pushId: push.id,
			userId: reviewerId,
			decision: "accept",
		});
		expect(result.ok).toBe(true);
		const rows = await listWorkflowRows(db, repoId);
		expect(JSON.stringify(rows[0]?.definition)).toContain("saved.example");
	});

	test("a second accept is refused and changes nothing", async () => {
		const repoId = await newRepo();
		await seeded(repoId, gate("gate", "Gate"));
		const push = await propose(repoId, [gate("gate", "Gate", 30)]);
		const decide = () =>
			decideWorkflowPush(db, {
				orgId,
				pushId: push.id,
				userId: reviewerId,
				decision: "accept",
			});
		const [first, second] = await Promise.all([decide(), decide()]);
		const results = [first, second];
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(results.find((result) => !result.ok)).toEqual({
			ok: false,
			reason: "already-decided",
			status: "accepted",
		});
		expect(
			await decideWorkflowPush(db, {
				orgId,
				pushId: push.id,
				userId: reviewerId,
				decision: "reject",
			}),
		).toEqual({ ok: false, reason: "already-decided", status: "accepted" });
	});

	test("a base edited since the push marks it stale and applies nothing", async () => {
		const repoId = await newRepo();
		const saved = await seeded(repoId, gate("gate", "Gate"));
		const push = await propose(repoId, [
			gate("gate", "Gate", 30),
			gate("fresh", "Fresh"),
		]);
		await saveWorkflowDefinition(db, {
			repoId,
			workflowId: saved.id,
			definition: gate("gate", "Gate", 14),
		});
		const result = await decideWorkflowPush(db, {
			orgId,
			pushId: push.id,
			userId: reviewerId,
			decision: "accept",
		});
		expect(result).toEqual({ ok: false, reason: "stale", workflows: ["Gate"] });
		const rows = await listWorkflowRows(db, repoId);
		expect(rows.map((row) => row.definition.id)).toEqual(["gate"]);
		expect(rows[0]?.definition.nodes[1]).toMatchObject({
			config: { minDays: 14 },
		});
		const read = await getWorkflowPush(db, { orgId, pushId: push.id });
		expect(read?.status).toBe("stale");
	});

	test("a new workflow created elsewhere since the push is stale too", async () => {
		const repoId = await newRepo();
		const push = await propose(repoId, [gate("fresh", "Fresh")]);
		await seeded(repoId, gate("fresh", "Fresh", 3));
		const result = await decideWorkflowPush(db, {
			orgId,
			pushId: push.id,
			userId: reviewerId,
			decision: "accept",
		});
		expect(result).toEqual({
			ok: false,
			reason: "stale",
			workflows: ["Fresh"],
		});
	});

	test("an expired push cannot be accepted", async () => {
		const repoId = await newRepo();
		const push = await propose(repoId, [gate("gate", "Gate")]);
		const result = await decideWorkflowPush(db, {
			orgId,
			pushId: push.id,
			userId: reviewerId,
			decision: "accept",
			now: new Date(push.expiresAt.getTime() + 1),
		});
		expect(result).toEqual({ ok: false, reason: "expired" });
		expect(await listWorkflowRows(db, repoId)).toHaveLength(0);
		const raw = await db
			.select({ status: workflowPushProposals.status })
			.from(workflowPushProposals)
			.where(eq(workflowPushProposals.id, push.id));
		expect(raw[0]?.status).toBe("expired");
	});

	test("reject closes the push without saving", async () => {
		const repoId = await newRepo();
		const push = await propose(repoId, [gate("gate", "Gate")]);
		expect(
			await decideWorkflowPush(db, {
				orgId,
				pushId: push.id,
				userId: reviewerId,
				decision: "reject",
			}),
		).toEqual({ ok: true, status: "rejected" });
		expect(await listWorkflowRows(db, repoId)).toHaveLength(0);
	});

	test("another org cannot decide the push", async () => {
		const repoId = await newRepo();
		const push = await propose(repoId, [gate("gate", "Gate")]);
		expect(
			await decideWorkflowPush(db, {
				orgId: otherOrgId,
				pushId: push.id,
				userId: reviewerId,
				decision: "accept",
			}),
		).toEqual({ ok: false, reason: "not-found" });
	});

	test("a workflow turned on since the push still blocks on errors it would bring", async () => {
		const repoId = await newRepo();
		const saved = await seeded(repoId, gate("gate", "Gate"));
		await setWorkflowEnabled(db, {
			repoId,
			workflowId: saved.id,
			enabled: true,
		});
		const push = await propose(repoId, [gate("gate", "Gate", 30)]);
		await db
			.update(workflowPushProposals)
			.set({
				entries: [
					{
						definition: broken("gate", "Gate"),
						baseWorkflowId: saved.id,
						baseHash: push.entries[0]?.baseHash ?? null,
						baseDefinition: push.entries[0]?.baseDefinition ?? null,
					},
				],
			})
			.where(eq(workflowPushProposals.id, push.id));
		const result = await decideWorkflowPush(db, {
			orgId,
			pushId: push.id,
			userId: reviewerId,
			decision: "accept",
		});
		expect(result).toMatchObject({ ok: false, reason: "blocked" });
		const read = await getWorkflowPush(db, { orgId, pushId: push.id });
		expect(read?.status).toBe("pending");
		const row = await db
			.select({ definition: workflowDefinitions.definition })
			.from(workflowDefinitions)
			.where(eq(workflowDefinitions.id, saved.id));
		expect(JSON.stringify(row)).toContain('"minDays":7');
	});
});
