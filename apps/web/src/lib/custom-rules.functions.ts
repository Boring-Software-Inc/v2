import { createServerFn } from "@tanstack/react-start";
import type { CustomRuleView, OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export type { CustomRuleView };

const GONE =
	"This rule no longer exists. Reload the page to see the current rules.";

export const listCustomRuleViews = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:read")])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<CustomRuleView[]> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { customRuleServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await customRuleServices.listCustomRuleViews(
			getDb().db,
			data.repoId,
		);
	});

export const saveCustomRule = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			/** Absent on create; present on edit. */
			id?: string;
			name: string;
			enabled: boolean;
			definition: unknown;
		}) => input,
	)
	.handler(
		async ({
			data,
			context,
		}): Promise<{ ok: true; id: string } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { customRuleServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const result = await customRuleServices.saveCustomRule(getDb().db, {
				repoId: data.repoId,
				id: data.id,
				name: data.name,
				enabled: data.enabled,
				definition: data.definition,
			});
			if (!result.ok) {
				return { error: result.reason === "not-found" ? GONE : result.error };
			}
			return { ok: true, id: result.rule.id };
		},
	);

export const setCustomRuleEnabled = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator(
		(input: { org: string; repoId: string; id: string; enabled: boolean }) =>
			input,
	)
	.handler(
		async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { customRuleServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const result = await customRuleServices.setCustomRuleEnabled(getDb().db, {
				repoId: data.repoId,
				id: data.id,
				enabled: data.enabled,
			});
			if (!result.ok) {
				return { error: result.reason === "not-found" ? GONE : result.error };
			}
			return { ok: true };
		},
	);

export const deleteCustomRule = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator((input: { org: string; repoId: string; id: string }) => input)
	.handler(
		async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { customRuleServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const result = await customRuleServices.deleteCustomRule(getDb().db, {
				repoId: data.repoId,
				id: data.id,
			});
			if (!result.ok) {
				return { error: result.reason === "not-found" ? GONE : result.error };
			}
			return { ok: true };
		},
	);
