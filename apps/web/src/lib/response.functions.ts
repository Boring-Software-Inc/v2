import { createServerFn } from "@tanstack/react-start";
import type {
	OrgResponseDefaults,
	RedactionPolicy,
	ResponseConfig,
} from "@tripwire/contracts";
import {
	orgResponseDefaultsSchema,
	responseConfigSchema,
} from "@tripwire/contracts";
import type { RedactionUsage } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	type OrgContext,
	orgMemberMiddleware,
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export interface OrgResponseDefaultsView {
	defaults: OrgResponseDefaults;
	usage: RedactionUsage;
}

type SaveResult = { ok: true } | { error: string };

const INVALID_SETTINGS =
	"These settings are not valid. Check the values and save again.";

function samePolicy(a: RedactionPolicy, b: RedactionPolicy): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export const getRepoResponseConfig = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<ResponseConfig> => {
		await requireOrgRepoById((context as OrgContext).org.id, data.repoId);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return repoServices.getResponseConfig(getDb().db, data.repoId);
	});

export const saveRepoResponseConfig = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("repoResponse:update"),
	])
	.inputValidator(
		(input: { org: string; repoId: string; config: unknown }) => input,
	)
	.handler(async ({ data, context }): Promise<SaveResult> => {
		await requireOrgRepoById((context as OrgContext).org.id, data.repoId);
		const parsed = responseConfigSchema.safeParse(data.config);
		if (!parsed.success) {
			return { error: parsed.error.issues[0]?.message ?? INVALID_SETTINGS };
		}
		const { repoServices, responseServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const before = await responseServices.getRedactionPolicy(db, data.repoId);
		await repoServices.upsertResponseConfig(db, data.repoId, parsed.data);
		const after = await responseServices.getRedactionPolicy(db, data.repoId);
		if (!samePolicy(before, after)) {
			const { enqueueSurfaceRefresh } = await import(
				"#/lib/server/refresh-surfaces"
			);
			await enqueueSurfaceRefresh([data.repoId]);
		}
		return { ok: true };
	});

export const getOrgResponseDefaults = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgResponseDefaultsView> => {
		const orgId = (context as OrgContext).org.id;
		const { responseServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const [defaults, usage] = await Promise.all([
			responseServices.getOrgResponseDefaults(db, orgId),
			responseServices.getOrgRedactionUsage(db, orgId),
		]);
		return { defaults, usage };
	});

export const saveOrgResponseDefaults = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("orgResponseDefaults:update"),
	])
	.inputValidator((input: { org: string; defaults: unknown }) => input)
	.handler(async ({ data, context }): Promise<SaveResult> => {
		const orgId = (context as OrgContext).org.id;
		const parsed = orgResponseDefaultsSchema.safeParse(data.defaults);
		if (!parsed.success) {
			return { error: parsed.error.issues[0]?.message ?? INVALID_SETTINGS };
		}
		const { responseServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const before = await responseServices.getOrgResponseDefaults(db, orgId);
		await responseServices.upsertOrgResponseDefaults(db, orgId, parsed.data);
		if (!samePolicy(before.redaction, parsed.data.redaction)) {
			const { enqueueSurfaceRefresh } = await import(
				"#/lib/server/refresh-surfaces"
			);
			await enqueueSurfaceRefresh(
				await responseServices.listInheritingRepoIds(db, orgId),
			);
		}
		return { ok: true };
	});
