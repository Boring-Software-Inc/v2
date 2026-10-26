import { createServerFn } from "@tanstack/react-start";
import type { RepoAgentRun, RepoSetupFacts } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	type OrgContext,
	orgPermissionMiddleware,
	requireOrgRepoById,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

export interface RepoSetupState {
	repoId: string;
	facts: RepoSetupFacts;
	agent: RepoAgentRun | null;
}

export const getRepoSetup = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("moderation:read"),
	])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<RepoSetupState | null> => {
		const org = (context as OrgContext).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { repoSetupServices, setupServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const [facts, agent] = await Promise.all([
			repoSetupServices.getRepoSetupFacts(db, {
				orgId: org.id,
				repoId: repo.id,
			}),
			setupServices.findRepoAgentRun(db, {
				orgId: org.id,
				repoFullName: repo.fullName,
			}),
		]);
		return facts ? { repoId: repo.id, facts, agent } : null;
	});

export const takeOverAgentSetup = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input: { org: string; code: string }) => input)
	.handler(async ({ data, context }): Promise<{ ended: boolean }> => {
		const org = (context as OrgContext).org;
		const { setupServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const ended = await setupServices.takeOverSetupRun(getDb().db, {
			orgId: org.id,
			code: data.code,
		});
		return { ended };
	});

export const keepResponseDefaults = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("responses:manage"),
	])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<{ ok: true }> => {
		await requireOrgRepoById((context as OrgContext).org.id, data.repoId);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const config = await repoServices.getResponseConfig(db, data.repoId);
		await repoServices.upsertResponseConfig(db, data.repoId, config);
		return { ok: true };
	});

export const markResponsesReviewed = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("responses:manage"),
	])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<{ changed: boolean }> => {
		const org = (context as OrgContext).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { repoSetupServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const changed = await repoSetupServices.markResponsesReviewed(getDb().db, {
			orgId: org.id,
			repoId: repo.id,
		});
		return { changed };
	});

export type OnboardingEvent = "started" | "completed";

export const claimOnboardingEvent = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			event: OnboardingEvent;
		}): { org: string; repoId: string; event: OnboardingEvent } => ({
			...input,
			event: input.event === "started" ? "started" : "completed",
		}),
	)
	.handler(async ({ data, context }): Promise<{ claimed: boolean }> => {
		const orgId = (context as OrgContext).org.id;
		await requireOrgRepoById(orgId, data.repoId);
		const { repoSetupServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const claimed = await repoSetupServices.claimOnboardingEvent(getDb().db, {
			orgId,
			repoId: data.repoId,
			event: data.event,
		});
		return { claimed };
	});
