import { createServerFn } from "@tanstack/react-start";
import { workflowDefinitionSchema } from "@tripwire/contracts";
import type {
	OrgWithRole,
	SetEnabledResult,
	WorkflowListItem,
	WorkflowRow,
} from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export type { SetEnabledResult, WorkflowListItem, WorkflowRow };

/**
 * Workflows surface (§grid + editor). Members read; admins mutate. Every fn
 * verifies the repo belongs to the URL's org (requireOrgRepoById — a foreign
 * repo id is a 404, indistinguishable from missing). Enabling is the ONLY
 * path that turns a workflow on, and it validates strictly server-side.
 */

export const listRepoWorkflows = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<WorkflowListItem[]> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { workflowServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await workflowServices.listWorkflows(getDb().db, data.repoId);
	});

export const getRepoWorkflow = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator(
		(input: { org: string; repoId: string; workflowId: string }) => input,
	)
	.handler(async ({ data, context }): Promise<WorkflowRow | null> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { workflowServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await workflowServices.getWorkflow(getDb().db, {
			repoId: data.repoId,
			workflowId: data.workflowId,
		});
	});

/**
 * Create — blank draft (auto-named) or a template instantiation when a
 * definition is supplied. ALWAYS created disabled (§4: saving never enables).
 */
export const createRepoWorkflow = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repoId: string; definition?: unknown }) => input,
	)
	.handler(
		async ({
			data,
			context,
		}): Promise<{ workflow?: WorkflowListItem; error?: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			let definition;
			if (data.definition !== undefined) {
				const parsed = workflowDefinitionSchema.safeParse(data.definition);
				if (!parsed.success) {
					return {
						error: parsed.error.issues[0]?.message ?? "invalid template",
					};
				}
				definition = parsed.data;
			}
			const { workflowServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const workflow = await workflowServices.createWorkflow(getDb().db, {
				repoId: data.repoId,
				definition,
			});
			return { workflow };
		},
	);

/** The editor's save. Drafts persist in ANY structural state; never enables. */
export const saveRepoWorkflow = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			workflowId: string;
			definition: unknown;
		}) => input,
	)
	.handler(
		async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const parsed = workflowDefinitionSchema.safeParse(data.definition);
			if (!parsed.success) {
				const issue = parsed.error.issues[0];
				return {
					ok: false,
					error: `${issue?.path.join(".")}: ${issue?.message}`,
				};
			}
			const { workflowServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			return await workflowServices.updateWorkflowDefinition(getDb().db, {
				repoId: data.repoId,
				workflowId: data.workflowId,
				definition: parsed.data,
			});
		},
	);

export const renameRepoWorkflow = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			workflowId: string;
			name: string;
		}) => input,
	)
	.handler(
		async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { workflowServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			return await workflowServices.renameWorkflow(getDb().db, {
				repoId: data.repoId,
				workflowId: data.workflowId,
				name: data.name,
			});
		},
	);

/** Duplicate — DISABLED regardless of the source's state (§4). */
export const duplicateRepoWorkflow = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repoId: string; workflowId: string }) => input,
	)
	.handler(
		async ({
			data,
			context,
		}): Promise<{ workflow?: WorkflowListItem; error?: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { workflowServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const workflow = await workflowServices.duplicateWorkflow(getDb().db, {
				repoId: data.repoId,
				workflowId: data.workflowId,
			});
			return workflow ? { workflow } : { error: "workflow not found" };
		},
	);

export const deleteRepoWorkflow = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repoId: string; workflowId: string }) => input,
	)
	.handler(async ({ data, context }): Promise<{ deleted: boolean }> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { workflowServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await workflowServices.deleteWorkflow(getDb().db, {
			repoId: data.repoId,
			workflowId: data.workflowId,
		});
	});

/**
 * The explicit enable/disable act (§4: separate from save). Enabling runs
 * validateWorkflowForEnable server-side; a refusal returns the issues so the
 * UI can show WHY instead of failing silently.
 */
export const setRepoWorkflowEnabled = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			workflowId: string;
			enabled: boolean;
		}) => input,
	)
	.handler(async ({ data, context }): Promise<SetEnabledResult> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { workflowServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await workflowServices.setWorkflowEnabled(getDb().db, {
			repoId: data.repoId,
			workflowId: data.workflowId,
			enabled: data.enabled,
		});
	});
