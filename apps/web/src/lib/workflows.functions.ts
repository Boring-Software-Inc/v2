import { createServerFn } from "@tanstack/react-start";
import {
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
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
		const row = await workflowServices.getWorkflow(getDb().db, {
			repoId: data.repoId,
			workflowId: data.workflowId,
		});
		if (!row) {
			return null;
		}
		// Never return stored webhook/discord secrets to the client in full.
		const { redactWorkflowSecrets } = await import("#/lib/workflow-secrets");
		return { ...row, definition: redactWorkflowSecrets(row.definition) };
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
			let definition: WorkflowDefinition | undefined;
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
		async ({
			data,
			context,
		}): Promise<{
			ok: boolean;
			error?: string;
			connectionIssues?: { nodeId: string; message: string }[];
		}> => {
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
			const db = getDb().db;
			// Set-only secrets: a blank webhook/discord field keeps the stored
			// value; a new value is validated (https + shape) before it persists.
			const { restoreWorkflowSecrets } = await import("#/lib/workflow-secrets");
			const existing = await workflowServices.getWorkflow(db, {
				repoId: data.repoId,
				workflowId: data.workflowId,
			});
			const merged = restoreWorkflowSecrets(
				parsed.data,
				existing?.definition ?? null,
			);
			if (merged.error) {
				return { ok: false, error: merged.error };
			}
			const result = await workflowServices.updateWorkflowDefinition(db, {
				repoId: data.repoId,
				workflowId: data.workflowId,
				definition: merged.definition,
			});
			if (!result.ok) {
				return result;
			}
			// Save is not blocked on delivery reachability — but a newly-set
			// webhook url the maintainer never tested gets checked here, and a
			// failure comes back as a node issue (same surface as validation).
			const { probeDelivery } = await import("#/lib/delivery-probe");
			const connectionIssues = await Promise.all(
				merged.changedUrlNodes.map(async ({ nodeId, url, kind }) => {
					const probe = await probeDelivery(url, kind);
					return probe.ok
						? null
						: {
								nodeId,
								message: `webhook connection failed: ${probe.failure}`,
							};
				}),
			);
			return {
				ok: true,
				connectionIssues: connectionIssues.filter(
					(issue): issue is { nodeId: string; message: string } =>
						issue !== null,
				),
			};
		},
	);

/**
 * The panel's "test connection" — POST a ping to a webhook/discord url through
 * the SSRF guard and report whether it lands. Admin-gated (it makes an outbound
 * request). The url is tested, never returned; failures name the class.
 */
export const testDeliveryConnection = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			url: string;
			kind: "webhook" | "discord";
		}) => input,
	)
	.handler(
		async ({
			data,
			context,
		}): Promise<{ ok: boolean; status?: number; failure?: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { probeDelivery } = await import("#/lib/delivery-probe");
			const result = await probeDelivery(data.url, data.kind);
			return result.ok
				? { ok: true, status: result.status }
				: { ok: false, failure: result.failure };
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
