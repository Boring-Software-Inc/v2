import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	type OrgWithPermissions,
	resolveOrgAccess,
} from "@tripwire/auth/org-gate";
import type { Db, OrgWithRole, RepoLite } from "@tripwire/db";
import { orgServices } from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { TOOL_SPECS, type ToolName } from "./catalog.ts";
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
	tool: ToolName,
): Promise<OrgWithPermissions> {
	const need = TOOL_SPECS[tool].need;
	if (need === "none") {
		throw new Error(`${tool} does not act on an org`);
	}
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
	if (need !== "org-shell" && !member.org.permissions.includes(need)) {
		throw new ToolError(
			`Your role in ${slug} cannot do this. Ask an admin of the org.`,
		);
	}
	return member.org;
}

export interface RepoRef {
	scope?: string;
	name: string;
}

export function parseRepoRef(input: string): RepoRef {
	const trimmed = input.trim();
	const path = /^https?:\/\//i.test(trimmed)
		? URL.canParse(trimmed)
			? new URL(trimmed).pathname
			: trimmed
		: trimmed;
	const parts = path.split("/").filter((part) => part.length > 0);
	const [first, second] = parts;
	if (first === undefined) {
		return { name: trimmed };
	}
	if (second === undefined) {
		return { name: first.replace(/\.git$/i, "") };
	}
	return { scope: first, name: second.replace(/\.git$/i, "") };
}

export class RepoNotFoundError extends ToolError {
	readonly org: string;

	constructor(message: string, org: string) {
		super(message, "list_repos");
		this.org = org;
	}
}

async function findRepo(
	ctx: ToolContext,
	org: OrgWithRole,
	name: string,
	owner?: string,
): Promise<RepoLite | null> {
	const found = await orgServices.getOrgRepo(ctx.db, {
		orgId: org.id,
		repoName: name,
	});
	if (!found) {
		return null;
	}
	if (
		owner !== undefined &&
		found.owner.toLowerCase() !== owner.toLowerCase()
	) {
		return null;
	}
	return found;
}

export async function resolveOrgRepo(
	ctx: ToolContext,
	requested: string | undefined,
	repo: string,
	tool: ToolName,
): Promise<{ org: OrgWithPermissions; repo: RepoLite }> {
	const ref = parseRepoRef(repo);
	if (ref.scope === undefined) {
		const org = await resolveOrg(ctx, requested, tool);
		const found = await findRepo(ctx, org, ref.name);
		if (!found) {
			throw new RepoNotFoundError(
				`The org ${org.slug} has no repo named ${ref.name}.`,
				org.slug,
			);
		}
		return { org, repo: found };
	}
	requireAccess(ctx);
	const scope = ref.scope.toLowerCase();
	const orgs = await orgServices.listUserOrgs(ctx.db, ctx.agent.userId);
	const named = orgs.find((org) => org.slug.toLowerCase() === scope);
	if (named) {
		const org = await resolveOrg(ctx, named.slug, tool);
		const found = await findRepo(ctx, org, ref.name);
		if (!found) {
			throw new RepoNotFoundError(
				`The org ${org.slug} has no repo named ${ref.name}.`,
				org.slug,
			);
		}
		return { org, repo: found };
	}
	const candidates = orgs.filter((org) =>
		requested
			? org.slug.toLowerCase() === requested.toLowerCase()
			: ctx.agent.orgIds.includes(org.id),
	);
	for (const candidate of candidates) {
		const found = await findRepo(ctx, candidate, ref.name, ref.scope);
		if (found) {
			return { org: await resolveOrg(ctx, candidate.slug, tool), repo: found };
		}
	}
	const org = await resolveOrg(ctx, requested, tool);
	throw new RepoNotFoundError(
		`You are not in an org named ${ref.scope}, and the org ${org.slug} has no repo ${ref.scope}/${ref.name}.`,
		org.slug,
	);
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
		if (error instanceof RepoNotFoundError) {
			return {
				...fail(error.message, error.hint),
				structuredContent: {
					error: error.message,
					hint: error.hint,
					org: error.org,
				},
			};
		}
		if (error instanceof ToolError) {
			return fail(error.message, error.hint);
		}
		throw error;
	}
}
