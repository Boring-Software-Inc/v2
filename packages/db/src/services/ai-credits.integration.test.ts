import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AI_CREDITS_COPY, type WorkflowDefinition } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { repos } from "../schema/repos.ts";
import { getAiCredits, recordAiCredits } from "./ai-provider.ts";
import { listRuleConfigs } from "./repos.ts";
import { listRuleViews, saveRuleConfig } from "./rules.ts";
import {
	applyWorkflowDefinition,
	createWorkflow,
	getWorkflow,
	listWorkflows,
	setWorkflowEnabled,
} from "./workflows.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let repoId: string;

function aiGate(name: string): WorkflowDefinition {
	return {
		id: generateId(),
		name,
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "ai-review@2", config: { maxSteps: 12 } },
			{ id: "a", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	};
}

async function aiView() {
	const views = await listRuleViews(db, repoId);
	const view = views.find((item) => item.ruleId === "ai-review");
	if (!view) {
		throw new Error("no ai-review view");
	}
	return view;
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	repoId = generateId();
	await db.insert(repos).values({
		id: repoId,
		externalId: "credits-1",
		owner: "acme",
		name: "credits",
		fullName: "acme/credits",
	});
}, 120_000);

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("the AI credit state", () => {
	test("reads ready before any check has run", async () => {
		expect(await getAiCredits(db)).toBe("ready");
	});

	test("records a change once and a repeat as no change", async () => {
		expect(await recordAiCredits(db, "out")).toEqual({ changed: true });
		expect(await recordAiCredits(db, "out")).toEqual({ changed: false });
		expect(await getAiCredits(db)).toBe("out");
		expect(await recordAiCredits(db, "ready")).toEqual({ changed: true });
		expect(await getAiCredits(db)).toBe("ready");
	});
});

describe("turning AI review on while credits are out", () => {
	test("the rule refuses to turn on and says why", async () => {
		await recordAiCredits(db, "out");
		const result = await saveRuleConfig(db, {
			repoId,
			ruleId: "ai-review",
			enabled: true,
			config: { maxSteps: 12 },
		});
		expect(result).toEqual({ error: AI_CREDITS_COPY.cantRun });
		const stored = await listRuleConfigs(db, repoId);
		expect(stored.find((row) => row.ruleId === "ai-review")).toBeUndefined();
		expect((await aiView()).unavailableReason).toBe(AI_CREDITS_COPY.reason);
	});

	test("other rules still save", async () => {
		const result = await saveRuleConfig(db, {
			repoId,
			ruleId: "account-age",
			enabled: true,
			config: { minDays: 7 },
		});
		expect(result).toEqual({ ok: true });
	});

	test("a rule already on keeps its config, can change settings and can turn off", async () => {
		await recordAiCredits(db, "ready");
		expect(
			await saveRuleConfig(db, {
				repoId,
				ruleId: "ai-review",
				enabled: true,
				config: { maxSteps: 12 },
			}),
		).toEqual({ ok: true });
		await recordAiCredits(db, "out");
		const view = await aiView();
		expect(view.enabled).toBe(true);
		expect(view.unavailableReason).toBe(AI_CREDITS_COPY.reason);
		expect(
			await saveRuleConfig(db, {
				repoId,
				ruleId: "ai-review",
				enabled: true,
				config: { maxSteps: 8 },
			}),
		).toEqual({ ok: true });
		expect(
			await saveRuleConfig(db, {
				repoId,
				ruleId: "ai-review",
				enabled: false,
				config: { maxSteps: 8 },
			}),
		).toEqual({ ok: true });
		expect(
			await saveRuleConfig(db, {
				repoId,
				ruleId: "ai-review",
				enabled: true,
				config: { maxSteps: 8 },
			}),
		).toEqual({ error: AI_CREDITS_COPY.cantRun });
	});

	test("a workflow with AI review can't turn on, and a live one reads Can't run", async () => {
		await recordAiCredits(db, "ready");
		const live = await createWorkflow(db, {
			repoId,
			name: "live ai gate",
			definition: aiGate("live ai gate"),
		});
		expect(
			await setWorkflowEnabled(db, {
				repoId,
				workflowId: live.id,
				enabled: true,
			}),
		).toMatchObject({ ok: true });
		const off = await createWorkflow(db, {
			repoId,
			name: "off ai gate",
			definition: aiGate("off ai gate"),
		});

		await recordAiCredits(db, "out");
		const refused = await setWorkflowEnabled(db, {
			repoId,
			workflowId: off.id,
			enabled: true,
		});
		expect(refused.ok).toBe(false);
		expect(refused.ok ? [] : refused.issues.map((i) => i.message)).toEqual([
			AI_CREDITS_COPY.cantRun,
		]);
		const states = Object.fromEntries(
			(await listWorkflows(db, repoId)).map((w) => [w.name, w.state]),
		);
		expect(states["live ai gate"]).toBe("cant-run");
		expect(states["off ai gate"]).toBe("cant-turn-on");
	});

	test("a push to a live workflow that already had AI review still lands", async () => {
		const rows = await listWorkflows(db, repoId);
		const live = rows.find((row) => row.name === "live ai gate");
		if (!live) {
			throw new Error("no live workflow");
		}
		const stored = await getWorkflow(db, { repoId, workflowId: live.id });
		if (!stored) {
			throw new Error("no stored workflow");
		}
		const renamed = { ...stored.definition, name: "live ai gate v2" };
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: renamed,
		});
		expect(result.ok).toBe(true);
	});

	test("a push that adds AI review to a live workflow is refused", async () => {
		await recordAiCredits(db, "ready");
		const plain: WorkflowDefinition = {
			...aiGate("plain gate"),
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{
					id: "r",
					type: "rule",
					ref: "account-age@1",
					config: { minDays: 7 },
				},
				{ id: "a", type: "action", action: "block" },
			],
		};
		const created = await createWorkflow(db, {
			repoId,
			name: "plain gate",
			definition: plain,
		});
		await setWorkflowEnabled(db, {
			repoId,
			workflowId: created.id,
			enabled: true,
		});
		await recordAiCredits(db, "out");
		const stored = await getWorkflow(db, { repoId, workflowId: created.id });
		if (!stored) {
			throw new Error("no stored workflow");
		}
		const result = await applyWorkflowDefinition(db, {
			repoId,
			definition: {
				...stored.definition,
				nodes: [
					...stored.definition.nodes,
					{
						id: "ai",
						type: "rule",
						ref: "ai-review@2",
						config: { maxSteps: 12 },
					},
				],
				edges: [
					...stored.definition.edges,
					{ id: "e3", from: "t", to: "ai" },
					{ id: "e4", from: "ai", to: "a", when: "fail" },
				],
			},
		});
		expect(result.ok).toBe(false);
		expect(result.ok ? [] : result.issues.map((i) => i.message)).toEqual([
			AI_CREDITS_COPY.cantRun,
		]);
	});
});

describe("concurrent credit reports", () => {
	test("the newest report wins whatever order they land in", async () => {
		const base = Date.now() + 60_000;
		await recordAiCredits(db, "ready", new Date(base));
		for (let round = 1; round <= 30; round++) {
			const reports = Array.from({ length: 8 }, (_, i) => ({
				credits: (round + i) % 2 === 0 ? ("out" as const) : ("ready" as const),
				at: new Date(base + round * 100 + i),
			}));
			await Promise.all(
				[...reports]
					.reverse()
					.map((report) => recordAiCredits(db, report.credits, report.at)),
			);
			expect(await getAiCredits(db)).toBe(reports[7]?.credits ?? "ready");
		}
	});

	test("every reported change is a real transition", async () => {
		const at = new Date(Date.now() + 120_000);
		await recordAiCredits(db, "ready", at);
		let changes = 0;
		for (let round = 0; round < 30; round++) {
			const results = await Promise.all(
				Array.from({ length: 8 }, (_, i) =>
					recordAiCredits(db, (round + i) % 2 === 0 ? "out" : "ready", at),
				),
			);
			changes += results.filter((result) => result.changed).length;
			expect(changes % 2 === 1).toBe((await getAiCredits(db)) === "out");
		}
	});

	test("a report older than the stored one changes nothing", async () => {
		await recordAiCredits(db, "out", new Date(Date.now() + 180_000));
		expect(
			await recordAiCredits(db, "ready", new Date(Date.now() + 170_000)),
		).toEqual({ changed: false });
		expect(await getAiCredits(db)).toBe("out");
	});
});
