import { createServerFn } from "@tanstack/react-start";
import type { ResponseConfig } from "@tripwire/contracts";
import { responseConfigSchema } from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

/**
 * Per-repo response config (customize). Read resolves absent/corrupt rows to
 * the defaults in the db service; write validates against
 * `responseConfigSchema` before persisting — the jsonb column only ever holds
 * already-parsed data (the rule-config precedent).
 */

export const getRepoResponseConfig = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<ResponseConfig> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return repoServices.getResponseConfig(getDb().db, data.repoId);
	});

export const saveRepoResponseConfig = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repoId: string; config: unknown }) => input,
	)
	.handler(
		async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const parsed = responseConfigSchema.safeParse(data.config);
			if (!parsed.success) {
				return { error: parsed.error.issues[0]?.message ?? "invalid config" };
			}
			const { repoServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			await repoServices.upsertResponseConfig(
				getDb().db,
				data.repoId,
				parsed.data,
			);
			return { ok: true };
		},
	);
