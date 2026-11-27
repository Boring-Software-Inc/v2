import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { organization } from "../schema/organizations.ts";
import { workflowDefinitions } from "../schema/repos.ts";
import { deliveryAuditStore } from "./delivery-audit.ts";
import { linkOrgInstallation } from "./organizations.ts";
import { readQueueHealth } from "./queue-health.ts";
import { ensureRepo, setRepoArmed } from "./repos.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

test("repos are found by GitHub id with what the audit needs to know", async () => {
	await db
		.insert(organization)
		.values({ id: "org-audit", name: "Audit", slug: "audit" });
	await linkOrgInstallation(db, { orgId: "org-audit", installationId: "11" });
	const armed = await ensureRepo(db, {
		externalId: "501",
		owner: "audit",
		name: "armed",
		fullName: "audit/armed",
		installationId: "11",
		orgId: "org-audit",
	});
	await setRepoArmed(db, armed, true);
	await db.insert(workflowDefinitions).values({
		id: generateId(),
		repoId: armed,
		name: "On push",
		definition: {
			nodes: [{ id: "trigger", type: "trigger", kinds: ["push"] }],
		},
	});
	await ensureRepo(db, {
		externalId: "502",
		owner: "audit",
		name: "off",
		fullName: "audit/off",
		installationId: "12",
	});

	const store = deliveryAuditStore(db);
	const targets = await store.deliveryTargets({
		repositoryIds: ["501", "502", "503"],
		installationIds: ["11", "12"],
	});
	expect(targets.repos.get("501")).toEqual({
		armed: true,
		claimed: true,
		removed: false,
		pushTriggered: true,
	});
	expect(targets.repos.get("502")).toEqual({
		armed: false,
		claimed: false,
		removed: false,
		pushTriggered: false,
	});
	expect(targets.repos.has("503")).toBe(false);
	expect([...targets.claimedInstallations]).toEqual(["11"]);
});

test("stored deliveries, problems and the cursor round-trip", async () => {
	const store = deliveryAuditStore(db);
	await db.insert(events).values({
		id: "e-audit",
		deliveryId: "guid-stored",
		rawKind: "pull_request",
		raw: {},
	});
	expect([
		...(await store.storedDeliveryGuids(["guid-stored", "guid-lost"])),
	]).toEqual(["guid-stored"]);
	expect(await store.storedDeliveryGuids([])).toEqual(new Set());

	expect(await store.readCursor()).toBeNull();
	const position = new Date("2026-11-27T02:00:00Z");
	await store.advanceCursor(position);
	await store.advanceCursor(new Date("2026-11-27T02:05:00Z"));
	expect(await store.readCursor()).toEqual(new Date("2026-11-27T02:05:00Z"));

	const problem = {
		guid: "guid-lost",
		attemptId: 7,
		event: "pull_request",
		action: "opened",
		installationId: "11",
		repositoryId: "501",
		deliveredAt: position,
		statusCode: 200,
	};
	await store.recordDeliveryProblem({ ...problem, status: "redelivered" });
	expect(
		(await store.deliveryProblems(["guid-lost"])).get("guid-lost")?.status,
	).toBe("redelivered");
	expect(
		await store.redeliveriesUpdatedBefore(new Date(Date.now() + 60_000)),
	).toEqual([{ guid: "guid-lost", event: "pull_request" }]);

	// Lost deliveries page through the queue alerts.
	expect((await readQueueHealth(db)).lostDeliveriesLastDay).toBe(0);
	await store.recordDeliveryProblem({ ...problem, status: "missed" });
	expect((await readQueueHealth(db)).lostDeliveriesLastDay).toBe(1);
	await store.setDeliveryProblemStatus("guid-lost", "recovered");
	expect((await readQueueHealth(db)).lostDeliveriesLastDay).toBe(0);
});
