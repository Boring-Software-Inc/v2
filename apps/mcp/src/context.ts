import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { assertOrgRole } from "@tripwire/auth/org-gate";
import type { OrgRole } from "@tripwire/contracts";
import type { Db, OrgWithRole, RepoLite } from "@tripwire/db";
import { orgServices } from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { McpConfig } from "./config.ts";
import type { VerifiedAgent } from "./token.ts";

export interface ToolContext {
	db: Db;
	pool: Pool;
	getBoss: () => Promise<PgBoss>;
	config: McpConfig;
	agent: VerifiedAgent;
	accessDenied: string | null;
}

export class ToolError extends Error {}

export function ok(data: unknown): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
	};
}

export function fail(message: string): CallToolResult {
	return { isError: true, content: [{ type: "text", text: message }] };
}

export function requireAccess(ctx: ToolContext): void {
	if (ctx.accessDenied) {
		throw new ToolError(ctx.accessDenied);
	}
}

export async function resolveOrg(
	ctx: ToolContext,
	slug: string,
	need: OrgRole,
): Promise<OrgWithRole> {
	requireAccess(ctx);
	const member = await assertOrgRole(ctx.db, {
		userId: ctx.agent.userId,
		orgSlug: slug,
		need: "member",
	});
	if (!member.ok) {
		throw new ToolError(
			`No org named ${slug} for this account. Call whoami to see your orgs.`,
		);
	}
	if (!ctx.agent.orgIds.includes(member.org.id)) {
		throw new ToolError(
			`This agent was not given access to ${slug}. Disconnect it under Agents in Tripwire settings, then connect again and pick ${slug}.`,
		);
	}
	if (need === "admin" && member.org.role !== "admin") {
		throw new ToolError(
			`Only an admin of ${slug} can do this. Ask an admin of the org.`,
		);
	}
	return member.org;
}

export async function resolveRepo(
	ctx: ToolContext,
	org: OrgWithRole,
	repo: string,
): Promise<RepoLite> {
	const name = repo.includes("/") ? (repo.split("/").pop() ?? repo) : repo;
	const found = await orgServices.getOrgRepo(ctx.db, {
		orgId: org.id,
		repoName: name,
	});
	if (!found) {
		throw new ToolError(
			`No repo named ${repo} in ${org.slug}. Call list_repos to see the repos.`,
		);
	}
	return found;
}

export function appLink(ctx: ToolContext, path: string): string {
	return `${ctx.config.appUrl}${path}`;
}

export async function guard(
	run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof ToolError) {
			return fail(error.message);
		}
		throw error;
	}
}
