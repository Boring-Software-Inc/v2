import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	liveNodeTouches,
	WORKFLOW_TEMPLATES,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { Client } from "pg";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { user } from "../schema/auth.ts";
import { oauthClient } from "../schema/oauth.ts";
import { organization } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import {
	applyAgentWorkflow,
	beginWorkflowWork,
	discardDraft,
	finishWorkflowWork,
	getWorkflowWithWork,
	getWorkflowWork,
	listWorkflowCards,
	promoteDraft,
	saveAgentDraft,
} from "./agent-work.ts";
import { liveMessageFor } from "./live.ts";
import { listEnabledWorkflows } from "./repos.ts";
import { listDueSchedules } from "./schedules.ts";
import { decideWorkflowPush, proposeWorkflowPush } from "./workflow-pushes.ts";
import { listWorkflows, setWorkflowEnabled } from "./workflows.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let url: string;

const agent = { userId: "agent-user", clientId: "claude-code" };
const T0 = new Date("2026-10-24T12:00:00.000Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

async function newRepo(name: string): Promise<string> {
	const id = generateId();
	await db.insert(repos).values({
		id,
		externalId: `ext-${id}`,
		owner: "g-r-i-m",
		name,
		fullName: `g-r-i-m/${name}`,
		armed: true,
		installationId: "inst-1",
	});
	return id;
}

function staleTemplate(): WorkflowDefinition {
	const found = WORKFLOW_TEMPLATES.find(
		(tpl) => tpl.name === "Close stale change requests",
	);
	if (!found) {
		throw new Error("template missing");
	}
	return { ...found.definition, id: generateId(), name: "Close stale PRs" };
}

beforeAll(async () => {
	container = await createTestDatabase();
	url = container.url;
	({ db, pool } = createDb(url));
	await applyMigrations(db);
	await db.insert(user).values({
		id: agent.userId,
		name: "grim",
		email: "grim@example.com",
		accessStatus: "approved",
	});
	await db.insert(oauthClient).values({
		id: generateId(),
		clientId: agent.clientId,
		name: "Claude Code",
		redirectUris: ["http://localhost/cb"],
	});
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("drafts from an agent", () => {
	test("a validated new workflow shows on the page as a draft with every node written", async () => {
		const repoId = await newRepo("scratch");
		const definition = staleTemplate();
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition,
			now: T0,
		});
		expect(saved.change.nodes.added.length).toBe(definition.nodes.length);

		const cards = await listWorkflowCards(db, { repoId, now: later(1) });
		expect(cards).toHaveLength(1);
		const card = cards[0];
		expect(card?.id).toBe(saved.draftId);
		expect(card?.draftId).toBe(saved.draftId);
		expect(card?.enabled).toBe(false);
		expect(card?.name).toBe("Close stale PRs");
		expect(card?.work?.agents[0]?.name).toBe("Claude Code");
		const live = liveNodeTouches(card?.work, later(1));
		expect([...live.values()].every((t) => t.action === "write")).toBe(true);
		expect(live.size).toBe(definition.nodes.length);
		expect(await listWorkflows(db, repoId)).toHaveLength(0);
	});

	test("a draft never runs, on any trigger, schedules included", async () => {
		const repoId = await newRepo("never-runs");
		await saveAgentDraft(db, {
			repoId,
			agent,
			definition: staleTemplate(),
			now: T0,
		});
		expect(
			await listEnabledWorkflows(db, "g-r-i-m/never-runs", "github"),
		).toEqual([]);
		const due = await listDueSchedules(db, later(60 * 60 * 24 * 30));
		expect(due.filter((entry) => entry.repoId === repoId)).toEqual([]);
	});

	test("a second check marks only what changed and bumps the revision", async () => {
		const repoId = await newRepo("second-pass");
		const definition = staleTemplate();
		await saveAgentDraft(db, { repoId, agent, definition, now: T0 });
		const [first, ...rest] = definition.nodes;
		if (!first) {
			throw new Error("empty template");
		}
		const next: WorkflowDefinition = {
			...definition,
			nodes: [...rest, { ...first, id: "added-step" }],
			edges: definition.edges.map((edge) => ({
				...edge,
				from: edge.from === first.id ? "added-step" : edge.from,
				to: edge.to === first.id ? "added-step" : edge.to,
			})),
		};
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition: next,
			now: later(50),
		});
		expect(saved.change.nodes.added).toEqual(["added-step"]);
		expect(saved.change.nodes.removed).toEqual([first.id]);
		const work = await getWorkflowWork(db, {
			repoId,
			definitionId: definition.id,
			now: later(51),
		});
		expect(work.draft?.revision).toBe(2);
		expect(work.draft?.lastChange?.nodes.added).toEqual(["added-step"]);
		const live = liveNodeTouches(work, later(51));
		expect(live.get("added-step")?.action).toBe("write");
		expect(live.get(first.id)?.action).toBe("delete");
		expect(live.size).toBe(2);
	});

	test("begin opens an empty draft at once and returns the id to use", async () => {
		const repoId = await newRepo("begin");
		const begun = await beginWorkflowWork(db, {
			repoId,
			agent,
			name: "Close stale PRs",
			now: T0,
		});
		const detail = await getWorkflowWithWork(db, {
			repoId,
			workflowId: begun.draftId,
			now: later(1),
		});
		expect(detail?.definition.nodes).toEqual([]);
		expect(detail?.name).toBe("Close stale PRs");
		expect(detail?.work?.agents).toHaveLength(1);
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition: { ...staleTemplate(), id: begun.definitionId },
			now: later(2),
		});
		expect(saved.draftId).toBe(begun.draftId);
	});

	test("finish clears the outline at once; listed nodes release only those", async () => {
		const repoId = await newRepo("finish");
		const definition = staleTemplate();
		await saveAgentDraft(db, { repoId, agent, definition, now: T0 });
		const [first] = definition.nodes;
		await finishWorkflowWork(db, {
			repoId,
			agent,
			workflow: definition.id,
			nodeIds: first ? [first.id] : [],
			now: later(1),
		});
		let work = await getWorkflowWork(db, {
			repoId,
			definitionId: definition.id,
			now: later(2),
		});
		expect(liveNodeTouches(work, later(2)).has(first?.id ?? "")).toBe(false);
		expect(liveNodeTouches(work, later(2)).size).toBe(
			definition.nodes.length - 1,
		);
		await finishWorkflowWork(db, { repoId, agent, now: later(3) });
		work = await getWorkflowWork(db, {
			repoId,
			definitionId: definition.id,
			now: later(4),
		});
		expect(liveNodeTouches(work, later(4)).size).toBe(0);
		expect(work.agents[0]?.finishedAt).not.toBeNull();
		expect(work.draft?.status).toBe("open");
	});

	test("an agent that stops signalling drops off after two minutes", async () => {
		const repoId = await newRepo("crash");
		const definition = staleTemplate();
		await saveAgentDraft(db, { repoId, agent, definition, now: T0 });
		const work = await getWorkflowWork(db, {
			repoId,
			definitionId: definition.id,
			now: later(121),
		});
		expect(work.agents).toEqual([]);
		expect(work.draft?.status).toBe("open");
	});
});

describe("saving a draft", () => {
	test("a person promotes a new draft and it stays off", async () => {
		const repoId = await newRepo("promote");
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition: staleTemplate(),
			now: T0,
		});
		const promoted = await promoteDraft(db, {
			repoId,
			draftId: saved.draftId,
			now: later(5),
		});
		expect(promoted.ok).toBe(true);
		const saves = await listWorkflows(db, repoId);
		expect(saves).toHaveLength(1);
		expect(saves[0]?.enabled).toBe(false);
		const cards = await listWorkflowCards(db, { repoId, now: later(6) });
		expect(cards.map((card) => card.draftId)).toEqual([null]);
	});

	test("the agent's apply saves the workflow off and promotes its draft", async () => {
		const repoId = await newRepo("apply");
		const definition = staleTemplate();
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition,
			now: T0,
		});
		const applied = await applyAgentWorkflow(db, {
			repoId,
			agent,
			definition,
			now: later(10),
		});
		expect(applied.ok).toBe(true);
		expect(applied.draftId).toBe(saved.draftId);
		const work = await getWorkflowWork(db, {
			repoId,
			definitionId: definition.id,
			now: later(11),
		});
		expect(work.draft?.status).toBe("promoted");
		expect(work.workflowId).not.toBeNull();
		const detail = await getWorkflowWithWork(db, {
			repoId,
			workflowId: saved.draftId,
			now: later(11),
		});
		expect(detail?.id).toBe(work.workflowId ?? "");
		expect(detail?.enabled).toBe(false);
	});

	test("an accepted push review saves the workflow and promotes its draft", async () => {
		const orgId = generateId();
		await db
			.insert(organization)
			.values({ id: orgId, name: orgId, slug: orgId, isPersonal: false });
		const repoId = await newRepo("push-review");
		const definition = staleTemplate();
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition,
			now: T0,
		});
		const proposed = await proposeWorkflowPush(db, {
			orgId,
			repoId,
			authorId: agent.userId,
			definitions: [definition],
			now: later(5),
		});
		if (!proposed.ok || proposed.kind !== "proposed") {
			throw new Error("expected a proposal");
		}
		const decided = await decideWorkflowPush(db, {
			orgId,
			pushId: proposed.push.id,
			userId: agent.userId,
			decision: "accept",
			now: later(10),
		});
		expect(decided.ok).toBe(true);
		const work = await getWorkflowWork(db, {
			repoId,
			definitionId: definition.id,
			now: later(11),
		});
		expect(work.draft?.id).toBe(saved.draftId);
		expect(work.draft?.status).toBe("promoted");
		expect(work.workflowId).not.toBeNull();
		const cards = await listWorkflowCards(db, { repoId, now: later(11) });
		expect(cards.map((card) => card.draftId)).toEqual([null]);
	});

	test("a rejected push review leaves the draft open", async () => {
		const orgId = generateId();
		await db
			.insert(organization)
			.values({ id: orgId, name: orgId, slug: orgId, isPersonal: false });
		const repoId = await newRepo("push-reject");
		const definition = staleTemplate();
		await saveAgentDraft(db, { repoId, agent, definition, now: T0 });
		const proposed = await proposeWorkflowPush(db, {
			orgId,
			repoId,
			authorId: agent.userId,
			definitions: [definition],
			now: later(5),
		});
		if (!proposed.ok || proposed.kind !== "proposed") {
			throw new Error("expected a proposal");
		}
		await decideWorkflowPush(db, {
			orgId,
			pushId: proposed.push.id,
			userId: agent.userId,
			decision: "reject",
			now: later(10),
		});
		const work = await getWorkflowWork(db, {
			repoId,
			definitionId: definition.id,
			now: later(11),
		});
		expect(work.draft?.status).toBe("open");
	});

	test("an agent edit to a live workflow waits in a draft; the live one keeps running", async () => {
		const repoId = await newRepo("live-edit");
		const definition = staleTemplate();
		const applied = await applyAgentWorkflow(db, {
			repoId,
			agent,
			definition,
			now: T0,
		});
		if (!applied.ok) {
			throw new Error("apply failed");
		}
		const on = await setWorkflowEnabled(db, {
			repoId,
			workflowId: applied.workflow.id,
			enabled: true,
		});
		expect(on.ok).toBe(true);
		const edited = { ...definition, name: "Close stale PRs faster" };
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition: edited,
			now: later(5),
		});
		expect(saved.workflowId).toBe(applied.workflow.id);
		const running = await listEnabledWorkflows(
			db,
			"g-r-i-m/live-edit",
			"github",
		);
		expect(running.map((wf) => wf.name)).toEqual(["Close stale PRs"]);
		const cards = await listWorkflowCards(db, { repoId, now: later(6) });
		expect(cards).toHaveLength(1);
		expect(cards[0]?.draftId).toBe(saved.draftId);
		expect(cards[0]?.enabled).toBe(true);
	});

	test("a discarded draft leaves the page", async () => {
		const repoId = await newRepo("discard");
		const saved = await saveAgentDraft(db, {
			repoId,
			agent,
			definition: staleTemplate(),
			now: T0,
		});
		expect(
			(
				await discardDraft(db, {
					repoId,
					draftId: saved.draftId,
					now: later(1),
				})
			).discarded,
		).toBe(true);
		expect(await listWorkflowCards(db, { repoId, now: later(2) })).toEqual([]);
	});

	test("an untouched draft expires after a day", async () => {
		const repoId = await newRepo("expire");
		await saveAgentDraft(db, {
			repoId,
			agent,
			definition: staleTemplate(),
			now: T0,
		});
		expect(
			await listWorkflowCards(db, { repoId, now: later(60 * 60 * 24 + 1) }),
		).toEqual([]);
	});
});

describe("live channel", () => {
	test("each signal notifies the agent channel, and only repo viewers get the work", async () => {
		const repoId = await newRepo("live");
		const listener = new Client({ connectionString: url });
		await listener.connect();
		const payloads: string[] = [];
		listener.on("notification", (msg) => {
			if (msg.channel === "agent" && msg.payload) {
				payloads.push(msg.payload);
			}
		});
		await listener.query("LISTEN agent");
		const definition = staleTemplate();
		await saveAgentDraft(db, { repoId, agent, definition });
		for (let i = 0; i < 50 && payloads.length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		await listener.end();
		const payload = payloads[0] ?? "";
		expect(JSON.parse(payload)).toEqual({
			type: "work",
			repoId,
			definitionId: definition.id,
		});
		const seen = await liveMessageFor(db, payload, {
			userId: "someone",
			canSeeRepo: (name) => name === "g-r-i-m/live",
		});
		expect(seen?.type).toBe("work");
		const hidden = await liveMessageFor(db, payload, {
			userId: "someone",
			canSeeRepo: () => false,
		});
		expect(hidden).toBeNull();
	});
});
