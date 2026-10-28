import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	orgServices,
	repositoryConnectionServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { normalizeWebhook } from "@tripwire/forge-github";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import pino from "pino";
import { upsertInstallation } from "./jobs/installation-sync.ts";

let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
const orgId = generateId();
const logger = pino({ level: "silent" });
let installationId: string;
let accountName: string;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	await db.insert(schema.organization).values({
		id: orgId,
		name: "Installation metadata fixture",
		slug: `metadata-${orgId}`,
	});
	const body = await Bun.file(
		new URL(
			"../fixtures/installation.created.json",
			import.meta.resolve("@tripwire/forge-github"),
		),
	).text();
	const event = normalizeWebhook(
		{
			deliveryId: generateId(),
			eventName: "installation",
			body,
			signature: null,
		},
		new Date().toISOString(),
	);
	if (!event || !("installation" in event))
		throw new Error("Expected the captured installation event");
	const raw: unknown = JSON.parse(body);
	await db.insert(schema.events).values({
		id: event.id,
		forge: event.forge,
		deliveryId: event.deliveryId,
		rawKind: "installation",
		raw,
	});
	await eventServices.markEventNormalized(db, pool, event.id, event);
	await upsertInstallation(
		db,
		{
			installationId: event.installation.externalId,
			account: event.installation.account,
			accountType: event.installation.accountType,
			repositories: event.repositories,
		},
		logger,
	);
	installationId = event.installation.externalId;
	accountName = event.installation.account;
}, 120_000);
afterAll(async () => {
	await pool?.end();
	await container?.stop();
});

test("captured GitHub sync before claim preserves the observed installation account", async () => {
	expect(
		await orgServices.getInstallationOrg(db, {
			installationId: installationId,
		}),
	).toBeNull();
	expect(
		await orgServices.linkOrgInstallation(db, {
			orgId,
			installationId: installationId,
			accountLogin: accountName,
		}),
	).toEqual({ claimed: true });
	const [claim] = await db
		.select()
		.from(schema.organizationInstallations)
		.where(eq(schema.organizationInstallations.installationId, installationId));
	expect(claim).toMatchObject({
		accountLogin: accountName,
		accountType: "Organization",
		organizationId: orgId,
	});
});

test("existing incomplete claims expose verified history metadata without granting or moving ownership", async () => {
	await orgServices.linkOrgInstallation(db, {
		orgId,
		installationId,
		accountLogin: accountName,
	});
	const [claim] = await db
		.select()
		.from(schema.organizationInstallations)
		.where(eq(schema.organizationInstallations.organizationId, orgId));
	if (!claim) throw new Error("Expected captured installation claim");
	await db
		.update(schema.organizationInstallations)
		.set({ accountType: null })
		.where(eq(schema.organizationInstallations.id, claim.id));
	const result =
		await repositoryConnectionServices.listOrganizationForgeConnections(
			db,
			orgId,
		);
	expect(result[0]?.installations).toEqual([
		{
			installationId: claim.installationId,
			owner: claim.accountLogin,
			accountType: "Organization",
		},
	]);
	expect(
		(
			await db
				.select()
				.from(schema.organizationInstallations)
				.where(eq(schema.organizationInstallations.id, claim.id))
		)[0]?.organizationId,
	).toBe(orgId);
	const unrelated = generateId();
	expect(
		await repositoryConnectionServices.listOrganizationForgeConnections(
			db,
			unrelated,
		),
	).toEqual([]);
});

test("metadata recovery repairs an owned repeat claim without changing another org's claim", async () => {
	await orgServices.linkOrgInstallation(db, {
		orgId,
		installationId,
		accountLogin: accountName,
	});
	const [claim] = await db
		.select()
		.from(schema.organizationInstallations)
		.where(eq(schema.organizationInstallations.organizationId, orgId));
	if (!claim) throw new Error("Expected captured installation claim");
	await db
		.update(schema.organizationInstallations)
		.set({ accountType: null })
		.where(eq(schema.organizationInstallations.id, claim.id));
	const otherOrgId = generateId();
	await db.insert(schema.organization).values({
		id: otherOrgId,
		name: "Other organization",
		slug: `metadata-other-${otherOrgId}`,
	});
	expect(
		await orgServices.linkOrgInstallation(db, {
			orgId: otherOrgId,
			installationId: claim.installationId,
		}),
	).toEqual({ claimed: false });
	const [unchanged] = await db
		.select()
		.from(schema.organizationInstallations)
		.where(eq(schema.organizationInstallations.id, claim.id));
	expect(unchanged).toMatchObject({ organizationId: orgId, accountType: null });
	expect(
		await orgServices.linkOrgInstallation(db, {
			orgId,
			installationId: claim.installationId,
		}),
	).toEqual({ claimed: true });
	const [repaired] = await db
		.select()
		.from(schema.organizationInstallations)
		.where(eq(schema.organizationInstallations.id, claim.id));
	expect(repaired).toMatchObject({
		organizationId: orgId,
		accountType: "Organization",
		accountLogin: claim.accountLogin,
	});
});
