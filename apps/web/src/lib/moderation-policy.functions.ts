import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	allowlistEntryInputSchema,
	allowlistLoginSchema,
	moderationOutcomeSchema,
	moderationSubjectSchema,
	repoModerationPolicyPatchSchema,
} from "@tripwire/contracts";
import { z } from "zod";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

const orgInput = z.object({ org: z.string().min(1) });
const repoInput = orgInput.extend({ repo: z.string().min(1) });

async function policyStore() {
	const { moderationPolicyServices } = await import("@tripwire/db");
	const { getDb } = await import("#/lib/server/db");
	return { services: moderationPolicyServices, db: getDb().db };
}

async function githubRepoId(orgId: string, repoName: string) {
	const repo = await resolveOrgRepo(orgId, repoName);
	if (repo.forge !== "github") throw notFound();
	return repo.id;
}

export const getOrgModerationPolicy = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("settings:read")])
	.inputValidator(orgInput)
	.handler(async ({ context }) => {
		const { services, db } = await policyStore();
		return services.getOrgPolicy(db, context.org.id);
	});

export const saveOrgModerationPolicy = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("settings:manage"),
	])
	.inputValidator(
		orgInput.extend({
			subject: moderationSubjectSchema,
			outcome: moderationOutcomeSchema,
		}),
	)
	.handler(async ({ context, data }) => {
		const { services, db } = await policyStore();
		return services.updateOrgDefault(
			db,
			context.org.id,
			data.subject,
			data.outcome,
		);
	});

export const getRepoModerationSettings = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:read")])
	.inputValidator(repoInput)
	.handler(async ({ context, data }) => {
		const id = await githubRepoId(context.org.id, data.repo);
		const { services, db } = await policyStore();
		const [policy, orgPolicy, allowlist] = await Promise.all([
			services.getRepoPolicy(db, id),
			services.getOrgPolicy(db, context.org.id),
			services.listAllowlistEntries(db, id),
		]);
		return { policy, orgDefaults: orgPolicy.defaults, allowlist };
	});

export const saveRepoModerationPolicy = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator(repoInput.extend({ patch: repoModerationPolicyPatchSchema }))
	.handler(async ({ context, data }) => {
		const id = await githubRepoId(context.org.id, data.repo);
		const { services, db } = await policyStore();
		await services.updateRepoPolicy(db, id, data.patch);
	});

export const addRepoAllowlistLogin = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator(repoInput.extend({ login: allowlistLoginSchema }))
	.handler(async ({ context, data }) => {
		const id = await githubRepoId(context.org.id, data.repo);
		const { services, db } = await policyStore();
		const { lookupGitHubAccount } = await import("#/lib/server/github-account");
		const account = await lookupGitHubAccount(data.login);
		if (!account) return { status: "missing-account" } as const;
		await services.addAllowlistEntry(db, id, {
			accountId: String(account.id),
			login: account.login,
		});
		return { status: "added" } as const;
	});

export const removeRepoAllowlistAccount = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator(
		repoInput.extend({ accountId: allowlistEntryInputSchema.shape.accountId }),
	)
	.handler(async ({ context, data }) => {
		const id = await githubRepoId(context.org.id, data.repo);
		const { services, db } = await policyStore();
		await services.removeAllowlistEntry(db, id, data.accountId);
	});
