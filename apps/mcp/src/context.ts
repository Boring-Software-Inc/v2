import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	type OrgWithPermissions,
	resolveOrgAccess,
} from "@tripwire/auth/org-gate";
import type { OrgPermission } from "@tripwire/contracts";
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

export const ERROR_HINTS = {
	list_orgs: "Call whoami to see your orgs.",
	pick_org: "Pass org, or call whoami to see them.",
	list_repos: "Call list_repos to see the repos.",
	list_runs: "Call list_runs to see recent runs.",
	list_queue: "Call list_moderation_queue to see the items.",
	list_rules: "Call list_rule_catalog to see the rules.",
	list_workflows: "Call list_workflows to see them.",
} as const;

export type ErrorHint = keyof typeof ERROR_HINTS;

export class ToolError extends Error {
	readonly hint?: ErrorHint;

	constructor(message: string, hint?: ErrorHint) {
		super(message);
		this.hint = hint;
	}
}

export function ok(data: unknown): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
	};
}

export function fail(message: string, hint?: ErrorHint): CallToolResult {
	return {
		isError: true,
		content: [
			{
				type: "text",
				text: hint ? `${message} ${ERROR_HINTS[hint]}` : message,
			},
		],
		structuredContent: hint ? { error: message, hint } : { error: message },
	};
}

export function requireAccess(ctx: ToolContext): void {
	if (ctx.accessDenied) {
		throw new ToolError(ctx.accessDenied);
	}
}

async function defaultOrgSlug(ctx: ToolContext): Promise<string> {
	const orgs = await orgServices.listUserOrgs(ctx.db, ctx.agent.userId);
	const granted = orgs.filter((o) => ctx.agent.orgIds.includes(o.id));
	const only = granted.length === 1 ? granted[0] : undefined;
	if (!only) {
		throw new ToolError("You can reach more than one org.", "pick_org");
	}
	return only.slug;
}

export async function resolveOrg(
	ctx: ToolContext,
	requested: string | undefined,
	need: "member" | OrgPermission,
): Promise<OrgWithPermissions> {
	requireAccess(ctx);
	const slug = requested ?? (await defaultOrgSlug(ctx));
	const member = await resolveOrgAccess(ctx.db, {
		userId: ctx.agent.userId,
		orgSlug: slug,
		requirement: { kind: "membership" },
	});
	if (!member.ok) {
		throw new ToolError(`No org named ${slug} for this account.`, "list_orgs");
	}
	if (!ctx.agent.orgIds.includes(member.org.id)) {
		throw new ToolError(
			`This agent was not given access to ${slug}. Disconnect it under Agents in Tripwire settings, then connect again and pick ${slug}.`,
		);
	}
	if (need !== "member" && !member.org.permissions.includes(need)) {
		throw new ToolError(
			`Your role in ${slug} cannot do this. Ask an admin of the org.`,
		);
	}
	return member.org;
}

export async function resolveRepo(
	ctx: ToolContext,
	org: OrgWithRole,
	repo: string,
): Promise<RepoLite> {
	const [owner, name] = repo.includes("/")
		? [
				repo.slice(0, repo.lastIndexOf("/")),
				repo.slice(repo.lastIndexOf("/") + 1),
			]
		: [undefined, repo];
	const found = await orgServices.getOrgRepo(ctx.db, {
		orgId: org.id,
		repoName: name,
	});
	if (
		!found ||
		(owner !== undefined && found.owner.toLowerCase() !== owner.toLowerCase())
	) {
		throw new ToolError(`No repo named ${repo} in ${org.slug}.`, "list_repos");
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
			return fail(error.message, error.hint);
		}
		throw error;
	}
}
