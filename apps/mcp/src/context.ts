import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	memberPermissions,
	type OrgWithPermissions,
	resolveOrgAccess,
} from "@tripwire/auth/org-gate";
import {
	DEFAULT_FORGE_ORIGIN,
	type ForgeId,
	type OrgPermission,
} from "@tripwire/contracts";
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
	list_custom_rules: "Call get_repo_rules to see the repo's rules.",
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

export async function grantedPermissions(
	db: Db,
	agent: Pick<VerifiedAgent, "userId" | "orgIds">,
): Promise<OrgPermission[]> {
	const held = new Set<OrgPermission>();
	for (const orgId of agent.orgIds) {
		const permissions = await memberPermissions(db, {
			orgId,
			userId: agent.userId,
		});
		for (const permission of permissions ?? []) {
			held.add(permission);
		}
	}
	return [...held];
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
	forge?: ForgeId;
	appPath?: boolean;
}

export function parseRepoRef(input: string, appUrl?: string): RepoRef {
	const trimmed = input.trim();
	let path = trimmed;
	let forge: ForgeId | undefined;
	let appPath = false;
	if (/^https?:\/\//i.test(trimmed)) {
		if (!URL.canParse(trimmed)) {
			throw new ToolError("Invalid repository URL.");
		}
		const url = new URL(trimmed);
		forge = (Object.keys(DEFAULT_FORGE_ORIGIN) as ForgeId[]).find(
			(id) => DEFAULT_FORGE_ORIGIN[id] === url.origin,
		);
		appPath = [
			"https://tripwire.sh",
			"https://staging.tripwire.sh",
			appUrl,
		].includes(url.origin);
		if (
			(!forge && !appPath) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			throw new ToolError(
				"Use a repository URL on a known forge, without credentials or query parameters.",
			);
		}
		path = url.pathname;
	}
	const parts = path.replace(/\/$/, "").replace(/^\//, "").split("/");
	const [first, second] = parts;
	if (!first || (!appPath && parts.length > 2) || (forge && !second)) {
		throw new ToolError("Use a repo name, owner/repo, or full repository URL.");
	}
	if (!second) return { name: first.replace(/\.git$/i, "") };
	const ref: RepoRef = {
		scope: first,
		name: second.replace(/\.git$/i, ""),
		forge,
	};
	if (appPath) ref.appPath = true;
	return ref;
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
	forge?: ForgeId,
): Promise<RepoLite | null> {
	return await orgServices.getOrgRepo(ctx.db, {
		orgId: org.id,
		repoName: name,
		owner,
		forge,
	});
}

export async function resolveOrgRepo(
	ctx: ToolContext,
	requested: string | undefined,
	repo: string,
	tool: ToolName,
): Promise<{ org: OrgWithPermissions; repo: RepoLite }> {
	const ref = parseRepoRef(repo, ctx.config.appUrl);
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
	const named =
		ref.forge === undefined
			? orgs.find((org) => org.slug.toLowerCase() === scope)
			: undefined;
	if (
		named &&
		requested &&
		requested.toLowerCase() !== named.slug.toLowerCase()
	) {
		throw new ToolError(
			"The repo reference and requested org disagree.",
			"pick_org",
		);
	}
	if (ref.appPath) {
		const org = await resolveOrg(ctx, ref.scope, tool);
		const found = await findRepo(ctx, org, ref.name);
		if (!found) {
			throw new RepoNotFoundError(
				`The org ${org.slug} has no repo named ${ref.name}.`,
				org.slug,
			);
		}
		return { org, repo: found };
	}
	const candidates = orgs.filter(
		(org) =>
			ctx.agent.orgIds.includes(org.id) &&
			(!requested || org.slug.toLowerCase() === requested.toLowerCase()),
	);
	const matches: { org: OrgWithPermissions; repo: RepoLite }[] = [];
	for (const candidate of candidates) {
		let org: OrgWithPermissions;
		try {
			org = await resolveOrg(ctx, candidate.slug, tool);
		} catch (error) {
			if (error instanceof ToolError) continue;
			throw error;
		}
		const ownerMatch = await findRepo(ctx, org, ref.name, ref.scope, ref.forge);
		const orgMatch =
			named?.id === org.id && !ref.forge
				? await findRepo(ctx, org, ref.name)
				: null;
		for (const found of [ownerMatch, orgMatch]) {
			if (found && !matches.some((match) => match.repo.id === found.id)) {
				matches.push({ org, repo: found });
			}
		}
	}
	if (matches.length > 1) {
		throw new ToolError(
			"That repo reference is ambiguous. Use a qualified repository URL.",
			"pick_org",
		);
	}
	const match = matches[0];
	if (match) return match;
	if (named) {
		const org = await resolveOrg(ctx, named.slug, tool);
		throw new RepoNotFoundError(
			`The org ${org.slug} has no repo named ${ref.name}.`,
			org.slug,
		);
	}

	const org = await resolveOrg(ctx, requested, tool);
	throw new RepoNotFoundError(
		`The org ${org.slug} has no repo ${ref.scope}/${ref.name}, and ${ref.scope} is not a Tripwire org you are in.`,
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
