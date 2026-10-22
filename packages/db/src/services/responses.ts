import {
	DEFAULT_ORG_RESPONSE_DEFAULTS,
	type OrgResponseDefaults,
	orgResponseDefaultsSchema,
	type RedactionPolicy,
	resolveRedaction,
	responseConfigSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.ts";
import { organizationResponseDefaults } from "../schema/organizations.ts";
import { repos, responseConfigs } from "../schema/repos.ts";
import { getResponseConfig } from "./repos.ts";

export interface RedactionUsage {
	inheriting: number;
	overriding: number;
}

export async function getOrgResponseDefaults(
	db: Db,
	orgId: string,
): Promise<OrgResponseDefaults> {
	const rows = await db
		.select({ config: organizationResponseDefaults.config })
		.from(organizationResponseDefaults)
		.where(eq(organizationResponseDefaults.organizationId, orgId))
		.limit(1);
	const parsed = orgResponseDefaultsSchema.safeParse(rows[0]?.config);
	return parsed.success ? parsed.data : DEFAULT_ORG_RESPONSE_DEFAULTS;
}

export async function upsertOrgResponseDefaults(
	db: Db,
	orgId: string,
	config: OrgResponseDefaults,
): Promise<void> {
	await db
		.insert(organizationResponseDefaults)
		.values({
			id: generateId(),
			organizationId: orgId,
			config,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [organizationResponseDefaults.organizationId],
			set: { config, updatedAt: new Date() },
		});
}

export async function getRedactionPolicy(
	db: Db,
	repoId: string | null,
): Promise<RedactionPolicy> {
	const config = await getResponseConfig(db, repoId);
	if (!config.redaction.inherit || !repoId) {
		return resolveRedaction(config.redaction, null);
	}
	const rows = await db
		.select({ orgId: repos.orgId })
		.from(repos)
		.where(eq(repos.id, repoId))
		.limit(1);
	const orgId = rows[0]?.orgId;
	if (!orgId) {
		return resolveRedaction(config.redaction, null);
	}
	const defaults = await getOrgResponseDefaults(db, orgId);
	return resolveRedaction(config.redaction, defaults.redaction);
}

async function listOrgRepoRedaction(db: Db, orgId: string) {
	const rows = await db
		.select({ repoId: repos.id, config: responseConfigs.config })
		.from(repos)
		.leftJoin(responseConfigs, eq(responseConfigs.repoId, repos.id))
		.where(and(eq(repos.orgId, orgId), isNull(repos.removedAt)));
	return rows.map((row) => {
		const parsed = responseConfigSchema.safeParse(row.config ?? {});
		return {
			repoId: row.repoId,
			inherits: !parsed.success || parsed.data.redaction.inherit,
		};
	});
}

export async function getOrgRedactionUsage(
	db: Db,
	orgId: string,
): Promise<RedactionUsage> {
	const rows = await listOrgRepoRedaction(db, orgId);
	const inheriting = rows.filter((row) => row.inherits).length;
	return { inheriting, overriding: rows.length - inheriting };
}

export async function listInheritingRepoIds(
	db: Db,
	orgId: string,
): Promise<string[]> {
	const rows = await listOrgRepoRedaction(db, orgId);
	return rows.filter((row) => row.inherits).map((row) => row.repoId);
}
