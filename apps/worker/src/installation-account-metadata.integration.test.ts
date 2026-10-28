import { afterAll, beforeAll, expect, test } from "bun:test";
import type { InstallationEvent } from "@tripwire/contracts";
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
import { and, eq } from "drizzle-orm";
import pino from "pino";
import { upsertInstallation } from "./jobs/installation-sync.ts";
import { recoverInstallation } from "./jobs/recover-installation.ts";

let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
const orgId = generateId();
const logger = pino({ level: "silent" });
let installationId: string;
let accountName: string;
let capturedInstallation: InstallationEvent;

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
	capturedInstallation = event;
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
	/** Installations predating the metadata cache must still use their normalized history. */
	await db
		.delete(schema.installationAccounts)
		.where(
			and(
				eq(schema.installationAccounts.forge, "github"),
				eq(schema.installationAccounts.installationId, installationId),
			),
		);
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

for (const admin of [true, false]) {
	test(`GitHub API recovery without a webhook preserves metadata and keeps claim authority separate (${admin ? "admin" : "not admin"})`, async () => {
		const isolated = await createTestDatabase();
		const recovered = createDb(isolated.url);
		try {
			await applyMigrations(recovered.db);
			const targetOrgId = generateId();
			const userId = generateId();
			await recovered.db.insert(schema.organization).values({
				id: targetOrgId,
				name: "Recovery target",
				slug: `recovery-${targetOrgId}`,
			});
			await recovered.db.insert(schema.user).values({
				id: userId,
				name: "Recovery fixture",
				email: `${userId}@example.test`,
			});
			await recovered.db.insert(schema.account).values({
				id: generateId(),
				userId,
				providerId: "github",
				accountId: capturedInstallation.actor.externalId,
				accessToken: "synthetic-domain-token",
			});
			const accountType = capturedInstallation.installation.accountType;
			if (accountType === undefined)
				throw new Error("Captured account type is required");
			const result = await recoverInstallation(
				{
					db: recovered.db,
					logger,
					report: () => undefined,
					github: {
						getInstallation: async () => ({
							account: capturedInstallation.installation.account,
							accountType: accountType,
							accountId: null,
						}),
						listRepositories: async () => capturedInstallation.repositories,
						userInstallationRepositories: async () => ({
							status: "listed",
							repositories: capturedInstallation.repositories.map((repo) => ({
								externalId: repo.externalId,
								admin,
							})),
						}),
					},
				},
				{ userId, installationId },
			);
			expect(result).toBe(admin ? "granted-admin" : "not-admin");
			expect(await recovered.db.select().from(schema.events)).toEqual([]);
			expect(
				await orgServices.getInstallationOrg(recovered.db, { installationId }),
			).toBeNull();
			expect(
				await orgServices.userCanClaimInstallation(recovered.db, {
					userId,
					forge: "github",
					installationId,
				}),
			).toBe(admin);
			if (admin) {
				expect(
					await orgServices.linkOrgInstallation(recovered.db, {
						orgId: targetOrgId,
						installationId,
						accountLogin: accountName,
					}),
				).toEqual({ claimed: true });
				const listed =
					await repositoryConnectionServices.listOrganizationForgeConnections(
						recovered.db,
						targetOrgId,
					);
				expect(listed[0]?.installations).toEqual([
					{ installationId, owner: accountName, accountType: "Organization" },
				]);
				expect(listed[0]?.repositories).toHaveLength(
					capturedInstallation.repositories.length,
				);
			} else {
				expect(
					await repositoryConnectionServices.listOrganizationForgeConnections(
						recovered.db,
						targetOrgId,
					),
				).toEqual([]);
			}
		} finally {
			await recovered.pool.end();
			await isolated.stop();
		}
	});
}
