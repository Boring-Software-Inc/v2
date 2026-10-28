import { createServerFn } from "@tanstack/react-start";
import type { RepoArmingResult } from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { z } from "zod";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	requireOrgRepoById,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

/**
 * §4 arming — turn the gate ON and enqueue arm-time backfill so the dashboard
 * has history immediately. Arming is always an explicit act (these are the
 * only UI paths to it), and an ADMIN act — it changes what the org enforces.
 * dev:demo has no worker/queue, so arming alone is enough there.
 */
async function armById(repoId: string): Promise<RepoArmingResult> {
	const { repoServices } = await import("@tripwire/db");
	const { getBoss, getDb, isDemoMode } = await import("#/lib/server/db");
	return await repoServices.turnOnGate(
		getDb().db,
		isDemoMode() ? null : getBoss,
		repoId,
	);
}

/** Arm the URL's repo (the scoped-page CTA). */
export const armRepo = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(
		async ({
			data,
			context,
		}): Promise<RepoArmingResult & { repoId: string }> => {
			const org = (context as { org: OrgWithRole }).org;
			const repo = await resolveOrgRepo(org.id, data.repo);
			return { ...(await armById(repo.id)), repoId: repo.id };
		},
	);

/**
 * Disarm — the gate back OFF (the palette's disarm action). Events keep
 * ingesting; only the RUN is skipped, same as a never-armed repo. No backfill
 * on the way back on later — the stored events are still there to replay.
 */
export const disarmRepo = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(
		async ({
			data,
			context,
		}): Promise<RepoArmingResult & { repoId: string }> => {
			const org = (context as { org: OrgWithRole }).org;
			const repo = await resolveOrgRepo(org.id, data.repo);
			const { repoServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const result = await repoServices.setRepoArmed(
				getDb().db,
				repo.id,
				false,
			);
			return { ...result, repoId: repo.id };
		},
	);

/** Arm a specific repo by id (org home rows) — must belong to the org. */
export const armRepoById = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<RepoArmingResult> => {
		const org = (context as { org: OrgWithRole }).org;
		await requireOrgRepoById(org.id, data.repoId);
		return await armById(data.repoId);
	});

const repoByIdInput = z.object({
	org: z.string().min(1),
	repoId: z.string().min(1),
});

export const disarmRepoById = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input: { org: string; repoId: string }) =>
		repoByIdInput.parse(input),
	)
	.handler(async ({ data, context }): Promise<RepoArmingResult> => {
		const org = (context as { org: OrgWithRole }).org;
		await requireOrgRepoById(org.id, data.repoId);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await repoServices.setRepoArmed(getDb().db, data.repoId, false);
	});
