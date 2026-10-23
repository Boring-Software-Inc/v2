import { generateId } from "@tripwire/utils";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
	agentGrants,
	oauthAccessToken,
	oauthClient,
	oauthClientResource,
	oauthConsent,
	oauthRefreshToken,
	oauthResource,
} from "../schema/oauth.ts";
import { organization } from "../schema/organizations.ts";

export const AGENT_GRANT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AgentGrant {
	userId: string;
	clientId: string;
	orgIds: string[];
	createdAt: Date;
}

export function agentGrantExpired(grant: AgentGrant, now = new Date()) {
	return now.getTime() - grant.createdAt.getTime() > AGENT_GRANT_MAX_AGE_MS;
}

export async function saveAgentGrant(
	db: Db,
	input: { userId: string; clientId: string; orgIds: string[] },
): Promise<void> {
	await db
		.insert(agentGrants)
		.values({
			id: generateId(),
			userId: input.userId,
			clientId: input.clientId,
			orgIds: input.orgIds,
		})
		.onConflictDoUpdate({
			target: [agentGrants.userId, agentGrants.clientId],
			set: { orgIds: input.orgIds, createdAt: new Date() },
		});
}

export async function getAgentGrant(
	db: Db,
	input: { userId: string; clientId: string },
): Promise<AgentGrant | null> {
	const rows = await db
		.select({
			userId: agentGrants.userId,
			clientId: agentGrants.clientId,
			orgIds: agentGrants.orgIds,
			createdAt: agentGrants.createdAt,
		})
		.from(agentGrants)
		.where(
			and(
				eq(agentGrants.userId, input.userId),
				eq(agentGrants.clientId, input.clientId),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function touchAgentGrant(
	db: Db,
	input: { userId: string; clientId: string },
): Promise<void> {
	await db
		.update(agentGrants)
		.set({ lastUsedAt: new Date() })
		.where(
			and(
				eq(agentGrants.userId, input.userId),
				eq(agentGrants.clientId, input.clientId),
			),
		);
}

export interface ConnectedAgent {
	clientId: string;
	name: string;
	orgs: { id: string; slug: string; name: string }[];
	connectedAt: string;
	lastUsedAt: string | null;
	expiresAt: string;
}

export async function listConnectedAgents(
	db: Db,
	userId: string,
): Promise<ConnectedAgent[]> {
	const rows = await db
		.select({
			clientId: agentGrants.clientId,
			name: oauthClient.name,
			orgIds: agentGrants.orgIds,
			createdAt: agentGrants.createdAt,
			lastUsedAt: agentGrants.lastUsedAt,
		})
		.from(agentGrants)
		.innerJoin(oauthClient, eq(oauthClient.clientId, agentGrants.clientId))
		.where(eq(agentGrants.userId, userId))
		.orderBy(sql`${agentGrants.createdAt} desc`);
	const orgIds = [...new Set(rows.flatMap((row) => row.orgIds))];
	const orgs = orgIds.length
		? await db
				.select({
					id: organization.id,
					slug: organization.slug,
					name: organization.name,
				})
				.from(organization)
				.where(inArray(organization.id, orgIds))
		: [];
	const orgById = new Map(orgs.map((org) => [org.id, org]));
	return rows.map((row) => ({
		clientId: row.clientId,
		name: row.name ?? row.clientId,
		orgs: row.orgIds.flatMap((id) => {
			const org = orgById.get(id);
			return org ? [org] : [];
		}),
		connectedAt: row.createdAt.toISOString(),
		lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
		expiresAt: new Date(
			row.createdAt.getTime() + AGENT_GRANT_MAX_AGE_MS,
		).toISOString(),
	}));
}

export async function revokeAgent(
	db: Db,
	input: { userId: string; clientId: string },
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.delete(agentGrants)
			.where(
				and(
					eq(agentGrants.userId, input.userId),
					eq(agentGrants.clientId, input.clientId),
				),
			);
		await tx
			.delete(oauthConsent)
			.where(
				and(
					eq(oauthConsent.userId, input.userId),
					eq(oauthConsent.clientId, input.clientId),
				),
			);
		await tx
			.delete(oauthAccessToken)
			.where(
				and(
					eq(oauthAccessToken.userId, input.userId),
					eq(oauthAccessToken.clientId, input.clientId),
				),
			);
		await tx
			.delete(oauthRefreshToken)
			.where(
				and(
					eq(oauthRefreshToken.userId, input.userId),
					eq(oauthRefreshToken.clientId, input.clientId),
				),
			);
	});
}

export async function removeOrgFromAgentGrants(
	db: Db,
	orgId: string,
): Promise<number> {
	const result = await db
		.update(agentGrants)
		.set({ orgIds: sql`array_remove(${agentGrants.orgIds}, ${orgId})` })
		.where(sql`${orgId} = ANY(${agentGrants.orgIds})`)
		.returning({ id: agentGrants.id });
	return result.length;
}

export async function ensurePublicAgentClient(
	db: Db,
	input: {
		clientId: string;
		name: string;
		scopes: string[];
		grantTypes: string[];
		resource: { identifier: string; name: string; allowedScopes: string[] };
	},
): Promise<void> {
	const now = new Date();
	await db
		.insert(oauthResource)
		.values({
			id: generateId(),
			identifier: input.resource.identifier,
			name: input.resource.name,
			allowedScopes: input.resource.allowedScopes,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing({ target: oauthResource.identifier });
	await db
		.insert(oauthClient)
		.values({
			id: generateId(),
			clientId: input.clientId,
			name: input.name,
			tokenEndpointAuthMethod: "none",
			applicationType: "native",
			grantTypes: input.grantTypes,
			responseTypes: [],
			redirectUris: [],
			scopes: input.scopes,
			requirePKCE: true,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing({ target: oauthClient.clientId });
	await db
		.insert(oauthClientResource)
		.values({
			id: generateId(),
			clientId: input.clientId,
			resourceId: input.resource.identifier,
			createdAt: now,
		})
		.onConflictDoNothing();
}
