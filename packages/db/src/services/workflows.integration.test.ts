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
	applyWorkflowDefinition,
	createWorkflow,
	deleteWorkflow,
	duplicateWorkflow,
	getWorkflow,
	listWorkflowRows,
	listWorkflows,
	previewWorkflowPush,
	renameWorkflow,
	saveWorkflowDefinition,
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
			expect(result.issues.some((i) => i.rule === "no-action")).toBe(true);
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

describe("saving a live workflow", () => {
	async function liveWorkflow() {
		const created = await createWorkflow(db, { repoId });
		const definition = { ...validGraph(), name: created.name };
		await updateWorkflowDefinition(db, {
			repoId,
			workflowId: created.id,
			definition,
		});
		await setWorkflowEnabled(db, {
			repoId,
			workflowId: created.id,
			enabled: true,
		});
		return { id: created.id, definition };
	}

	test("a live workflow refuses a save that could not be turned on", async () => {
		const live = await liveWorkflow();
		const result = await saveWorkflowDefinition(db, {
			repoId,
			workflowId: live.id,
			definition: {
				...live.definition,
				edges: [
					...live.definition.edges,
					{ id: "stale", from: "r", to: "deleted-step", when: "fail" },
				],
			},
		});
		expect(result.ok).toBe(false);
		const loaded = await getWorkflow(db, { repoId, workflowId: live.id });
		expect(loaded?.definition.edges.map((edge) => edge.id)).toEqual([
			"e1",
			"e2",
		]);
	});

	test("a draft still saves in any state", async () => {
		const created = await createWorkflow(db, { repoId });
		const result = await saveWorkflowDefinition(db, {
			repoId,
			workflowId: created.id,
			definition: {
				...validGraph(),
				name: created.name,
				edges: [{ id: "stale", from: "r", to: "deleted-step" }],
			},
		});
		expect(result.ok).toBe(true);
	});

	test("the list flags a live workflow the worker cannot run", async () => {
		const live = await liveWorkflow();
		await updateWorkflowDefinition(db, {
			repoId,
			workflowId: live.id,
			definition: {
				...live.definition,
				edges: [
					...live.definition.edges,
					{ id: "stale", from: "r", to: "deleted-step", when: "fail" },
				],
			},
		});
		const listed = await listWorkflows(db, repoId);
		expect(listed.find((item) => item.id === live.id)).toMatchObject({
			runnable: false,
			state: "cant-run",
		});
		const healthy = await liveWorkflow();
		expect(
			(await listWorkflows(db, repoId)).find((item) => item.id === healthy.id)
				?.runnable,
		).toBe(true);
	});

	test("an off workflow its wiring would stop says it cannot be turned on", async () => {
		const created = await createWorkflow(db, { repoId });
		await updateWorkflowDefinition(db, {
			repoId,
			workflowId: created.id,
			definition: {
				...validGraph(),
				name: created.name,
				edges: [{ id: "stale", from: "r", to: "deleted-step", when: "fail" }],
			},
		});
		const listed = (await listWorkflows(db, repoId)).find(
			(item) => item.id === created.id,
		);
		expect(listed).toMatchObject({
			enabled: false,
			runnable: false,
			canTurnOn: false,
			state: "cant-turn-on",
		});
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
		expect(row?.schedules).toEqual([]);
	});

	test("list carries each schedule in the words every surface uses", async () => {
		const created = await createWorkflow(db, {
			repoId,
			definition: {
				id: generateId(),
				name: "scheduled",
				version: 1,
				nodes: [
					{
						id: "t",
						type: "trigger",
						kinds: ["schedule.matched"],
						schedule: { every: { cron: "30 */2 * * *" }, match: {} },
					},
				],
				edges: [],
			},
			name: "scheduled",
		});
		const list = await listWorkflows(db, repoId);
		const row = list.find((w) => w.id === created.id);
		expect(row?.schedules).toEqual(["Every 2 hours at :30 in UTC"]);
	});
});

describe("applyWorkflowDefinition (workflows as code)", () => {
	const code = (id: string, minDays: number): WorkflowDefinition => ({
		id,
		name: `code ${id}`,
		version: 1,
		nodes: [
			{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] },
			{
				id: "account-age",
				type: "rule",
				ref: "account-age@1",
				config: { minDays },
			},
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "trigger", to: "account-age" },
			{ id: "e2", from: "account-age", to: "block", when: "fail" },
		],
	});

	test("a new id creates a workflow that starts off", async () => {
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: code("as-code-1", 7),
		});
		expect(result.ok && result.outcome).toBe("created");
		expect(result.ok && result.workflow.enabled).toBe(false);
	});

	test("the same code again changes nothing", async () => {
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: code("as-code-1", 7),
		});
		expect(result.ok && result.outcome).toBe("unchanged");
	});

	test("an edit updates in place and keeps canvas positions", async () => {
		const [row] = (await listWorkflowRows(db, repoId)).filter(
			(entry) => entry.definition.id === "as-code-1",
		);
		if (!row) {
			throw new Error("missing");
		}
		await updateWorkflowDefinition(db, {
			repoId,
			workflowId: row.id,
			definition: {
				...row.definition,
				nodes: row.definition.nodes.map((node) => ({
					...node,
					position: { x: 5, y: 6 },
				})),
			},
		});
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: code("as-code-1", 30),
		});
		expect(result.ok && result.outcome).toBe("updated");
		expect(result.ok && result.changes.map((change) => change.text)).toEqual([
			"account-age.minDays: 7 → 30",
		]);
		const stored = await getWorkflow(db, { repoId, workflowId: row.id });
		expect(stored?.definition.nodes[1]).toEqual({
			id: "account-age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 30 },
			position: { x: 5, y: 6 },
		});
	});

	test("a live workflow refuses code that could not be turned on", async () => {
		const [row] = (await listWorkflowRows(db, repoId)).filter(
			(entry) => entry.definition.id === "as-code-1",
		);
		if (!row) {
			throw new Error("missing");
		}
		await setWorkflowEnabled(db, {
			repoId,
			workflowId: row.id,
			enabled: true,
		});
		const broken = code("as-code-1", 30);
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: {
				...broken,
				edges: [
					...broken.edges,
					{ id: "loop", from: "block", to: "account-age" },
				],
			},
		});
		expect(result.ok).toBe(false);
	});
});

describe("pushing workflows as code keeps names unique", () => {
	test("a push that renames onto another workflow's name is refused", async () => {
		const first = { ...validGraph(), name: "Taken by first" };
		const second = { ...validGraph(), name: "Second" };
		await applyWorkflowDefinition(db, { repoId, definition: first });
		await applyWorkflowDefinition(db, { repoId, definition: second });
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: { ...second, name: "Taken by first" },
		});
		expect(result.ok).toBe(false);
		const names = (await listWorkflows(db, repoId)).map((item) => item.name);
		expect(names.filter((name) => name === "Taken by first")).toHaveLength(1);
	});

	test("a new workflow pushed with a taken name is refused", async () => {
		await applyWorkflowDefinition(db, {
			repoId,
			definition: { ...validGraph(), name: "Only once" },
		});
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: { ...validGraph(), name: "Only once" },
		});
		expect(result.ok).toBe(false);
	});
});

describe("turning on and saving at once", () => {
	test("never leaves a live workflow with wiring it cannot run", async () => {
		for (let round = 0; round < 10; round++) {
			const created = await createWorkflow(db, { repoId });
			const definition = { ...validGraph(), name: created.name };
			await updateWorkflowDefinition(db, {
				repoId,
				workflowId: created.id,
				definition,
			});
			await Promise.all([
				setWorkflowEnabled(db, {
					repoId,
					workflowId: created.id,
					enabled: true,
				}),
				saveWorkflowDefinition(db, {
					repoId,
					workflowId: created.id,
					definition: {
						...definition,
						edges: [
							...definition.edges,
							{ id: "stale", from: "r", to: "gone", when: "fail" },
						],
					},
				}),
			]);
			const listed = (await listWorkflows(db, repoId)).find(
				(item) => item.id === created.id,
			);
			expect(listed?.state).not.toBe("cant-run");
		}
	});
});

describe("validating code reads it the way a push stores it", () => {
	const hook = (id: string, url?: string): WorkflowDefinition => ({
		id,
		name: `hook ${id}`,
		version: 1,
		nodes: [
			{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] },
			url
				? { id: "notify", type: "action", action: "webhook", params: { url } }
				: { id: "notify", type: "action", action: "webhook" },
		],
		edges: [{ id: "e1", from: "trigger", to: "notify" }],
	});
	const URL = "https://hooks.example.com/tripwire";

	test("pulled code keeps the URL saved on the server", async () => {
		const created = await createWorkflow(db, {
			repoId,
			name: "hook hook-pulled",
			definition: hook("hook-pulled", URL),
		});
		const on = await setWorkflowEnabled(db, {
			repoId,
			workflowId: created.id,
			enabled: true,
		});
		expect(on.ok).toBe(true);

		const preview = await previewWorkflowPush(db, {
			repoId,
			definitions: [hook("hook-pulled")],
		});
		expect(preview.valid).toBe(true);
		expect(preview.workflows[0]?.enabled).toBe(true);
		expect(preview.workflows[0]?.changes).toEqual([]);

		const applied = await applyWorkflowDefinition(db, {
			repoId,
			definition: hook("hook-pulled"),
		});
		expect(applied.ok && applied.outcome).toBe("unchanged");
	});

	test("a URL written in code is dropped, so it cannot make code valid", async () => {
		const preview = await previewWorkflowPush(db, {
			repoId,
			definitions: [hook("hook-new", URL)],
		});
		expect(preview.valid).toBe(false);
		expect(
			preview.workflows[0]?.issues.map((issue) => issue.message),
		).toContain("Set the webhook URL. It must use HTTPS.");

		const applied = await applyWorkflowDefinition(db, {
			repoId,
			definition: hook("hook-new", URL),
		});
		expect(applied.ok && applied.outcome).toBe("created");
		const [row] = (await listWorkflowRows(db, repoId)).filter(
			(entry) => entry.definition.id === "hook-new",
		);
		expect(JSON.stringify(row?.definition)).not.toContain(URL);
	});
});
