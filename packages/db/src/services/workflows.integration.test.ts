import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { repos } from "../schema/repos.ts";
import {
	createWorkflow,
	deleteWorkflow,
	duplicateWorkflow,
	getWorkflow,
	listWorkflows,
	renameWorkflow,
	setWorkflowEnabled,
	updateWorkflowDefinition,
} from "./workflows.ts";

/**
 * §workflows grid CRUD — real Postgres. The load-bearing invariants:
 * created/duplicated workflows are DISABLED, enabling requires the strict
 * validator to pass (and refuses with issues), saving never enables.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let repoId: string;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	repoId = generateId();
	await db.insert(repos).values({
		id: repoId,
		externalId: "wf-1",
		owner: "acme",
		name: "api",
		fullName: "acme/api",
	});
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

/** A minimal VALID-for-enable graph: trigger → rule —fail→ block. */
function validGraph(): WorkflowDefinition {
	return {
		id: generateId(),
		name: "placeholder",
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
				config: { minDays: 7 },
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

describe("create", () => {
	test("created DISABLED with an auto-generated name", async () => {
		const created = await createWorkflow(db, { repoId, seed: 5 });
		expect(created.enabled).toBe(false);
		expect(created.name).toMatch(/^[a-z]+-[a-z]+(-\d+)?$/);
		expect(created.nodeCount).toBe(1); // the draft shell trigger
	});

	test("name collisions auto-retry", async () => {
		const a = await createWorkflow(db, { repoId, seed: 11 });
		const b = await createWorkflow(db, { repoId, seed: 11 });
		expect(b.name).not.toBe(a.name);
	});

	test("positions survive the round trip", async () => {
		const created = await createWorkflow(db, {
			repoId,
			definition: validGraph(),
		});
		const loaded = await getWorkflow(db, { repoId, workflowId: created.id });
		const trigger = loaded?.definition.nodes.find((n) => n.type === "trigger");
		expect(trigger?.position).toEqual({ x: 0, y: 0 });
	});
});

describe("enable gating", () => {
	test("a valid graph enables; disabling always succeeds", async () => {
		const created = await createWorkflow(db, {
			repoId,
			definition: validGraph(),
		});
		const on = await setWorkflowEnabled(db, {
			repoId,
			workflowId: created.id,
			enabled: true,
		});
		expect(on).toEqual({ ok: true, enabled: true });
		const off = await setWorkflowEnabled(db, {
			repoId,
			workflowId: created.id,
			enabled: false,
		});
		expect(off).toEqual({ ok: true, enabled: false });
	});

	test("enable REFUSES with issues: draft shell has no reachable action", async () => {
		const draft = await createWorkflow(db, { repoId });
		const result = await setWorkflowEnabled(db, {
			repoId,
			workflowId: draft.id,
			enabled: true,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.issues.some((i) => /no action is reachable/.test(i.message)),
			).toBe(true);
		}
	});

	test("enable REFUSES on bad rule config", async () => {
		const graph = validGraph();
		const rule = graph.nodes.find((n) => n.type === "rule");
		if (rule?.type === "rule") {
			rule.config = { minDays: -3 }; // violates z.number().int().min(0)
		}
		const created = await createWorkflow(db, { repoId, definition: graph });
		const result = await setWorkflowEnabled(db, {
			repoId,
			workflowId: created.id,
			enabled: true,
		});
		expect(result.ok).toBe(false);
	});

	test("saving never enables", async () => {
		const created = await createWorkflow(db, { repoId });
		await updateWorkflowDefinition(db, {
			repoId,
			workflowId: created.id,
			definition: { ...validGraph(), name: created.name },
		});
		const loaded = await getWorkflow(db, { repoId, workflowId: created.id });
		expect(loaded?.enabled).toBe(false);
	});
});

describe("duplicate / rename / delete", () => {
	test("duplicate of an ENABLED workflow is DISABLED with a fresh identity", async () => {
		const created = await createWorkflow(db, {
			repoId,
			definition: validGraph(),
		});
		await setWorkflowEnabled(db, {
			repoId,
			workflowId: created.id,
			enabled: true,
		});
		const copy = await duplicateWorkflow(db, {
			repoId,
			workflowId: created.id,
		});
		expect(copy?.enabled).toBe(false);
		expect(copy?.name).not.toBe(created.name);
		const loadedCopy = await getWorkflow(db, {
			repoId,
			workflowId: copy?.id as string,
		});
		const loadedSource = await getWorkflow(db, {
			repoId,
			workflowId: created.id,
		});
		expect(loadedCopy?.definition.id).not.toBe(loadedSource?.definition.id);
	});

	test("rename refuses duplicates and empty; definition name follows", async () => {
		const a = await createWorkflow(db, { repoId, seed: 21 });
		const b = await createWorkflow(db, { repoId, seed: 22 });
		expect(
			(await renameWorkflow(db, { repoId, workflowId: b.id, name: a.name })).ok,
		).toBe(false);
		expect(
			(await renameWorkflow(db, { repoId, workflowId: b.id, name: "  " })).ok,
		).toBe(false);
		const renamed = await renameWorkflow(db, {
			repoId,
			workflowId: b.id,
			name: "night watch",
		});
		expect(renamed.ok).toBe(true);
		const loaded = await getWorkflow(db, { repoId, workflowId: b.id });
		expect(loaded?.name).toBe("night watch");
		expect(loaded?.definition.name).toBe("night watch");
	});

	test("delete removes the row; foreign repo ids can't touch it", async () => {
		const created = await createWorkflow(db, { repoId });
		const foreign = await deleteWorkflow(db, {
			repoId: "not-my-repo",
			workflowId: created.id,
		});
		expect(foreign.deleted).toBe(false);
		const owned = await deleteWorkflow(db, {
			repoId,
			workflowId: created.id,
		});
		expect(owned.deleted).toBe(true);
	});

	test("list carries trigger summary + node count", async () => {
		const created = await createWorkflow(db, {
			repoId,
			definition: { ...DEFAULT_WORKFLOW, id: generateId(), name: "listed" },
			name: "listed",
		});
		const list = await listWorkflows(db, repoId);
		const row = list.find((w) => w.id === created.id);
		expect(row?.nodeCount).toBe(8);
		expect(row?.triggerKinds).toContain("change-request.opened");
	});
});
