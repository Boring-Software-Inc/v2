import type { Forge, WorkflowDefinition } from "@tripwire/contracts";
import { type Db, repoServices, schema, workflowServices } from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";

/**
 * Pin the sacrificial repo's SAVED WORKFLOWS to exactly what a scenario needs,
 * then restore the maintainer's real rows on exit — the workflow_definitions
 * sibling of rule-configs.ts. The worker prefers enabled saved workflows over
 * the derived default (run-workflows.ts), so this is how a scenario forces
 * "the graph the editor emitted" through the REAL pipeline.
 */

export interface PinnedWorkflow {
	definition: WorkflowDefinition;
	/** Insert the row enabled? Disabled rows prove §4: saved ≠ running. */
	enabled: boolean;
}

export interface WorkflowSnapshot {
	repoId: string;
	prior: {
		id: string;
		name: string;
		enabled: boolean;
		definition: unknown;
	}[];
}

export async function pinWorkflows(
	db: Db,
	repoFullName: string,
	workflows: PinnedWorkflow[],
	/**
	 * Required, and not defaulted. `getRepoByFullName` filters on forge, so
	 * omitting it matched nothing and reported the repo as absent even when the
	 * row was right there. `scripts/` is outside `bun run typecheck`, so the
	 * missing argument compiled — name it at every call site.
	 */
	forge: Forge = "github",
): Promise<WorkflowSnapshot> {
	const repo = await repoServices.getRepoByFullName(db, repoFullName, forge);
	if (!repo) {
		throw new Error(`repo ${repoFullName} is not in the DB on ${forge}`);
	}
	const prior = await db
		.select({
			id: schema.workflowDefinitions.id,
			name: schema.workflowDefinitions.name,
			enabled: schema.workflowDefinitions.enabled,
			definition: schema.workflowDefinitions.definition,
		})
		.from(schema.workflowDefinitions)
		.where(eq(schema.workflowDefinitions.repoId, repo.id));
	await db
		.delete(schema.workflowDefinitions)
		.where(eq(schema.workflowDefinitions.repoId, repo.id));
	for (const wf of workflows) {
		const created = await workflowServices.createWorkflow(db, {
			repoId: repo.id,
			name: wf.definition.name,
			definition: wf.definition,
		});
		if (wf.enabled) {
			const result = await workflowServices.setWorkflowEnabled(db, {
				repoId: repo.id,
				workflowId: created.id,
				enabled: true,
			});
			if (!result.ok) {
				throw new Error(
					`scenario workflow failed enable validation: ${result.issues
						.map((i) => i.message)
						.join("; ")}`,
				);
			}
		}
	}
	return { repoId: repo.id, prior };
}

export async function restoreWorkflows(
	db: Db,
	snapshot: WorkflowSnapshot,
): Promise<void> {
	await db
		.delete(schema.workflowDefinitions)
		.where(eq(schema.workflowDefinitions.repoId, snapshot.repoId));
	for (const row of snapshot.prior) {
		await db.insert(schema.workflowDefinitions).values({
			id: generateId(),
			repoId: snapshot.repoId,
			name: row.name,
			enabled: row.enabled,
			definition: row.definition,
		});
	}
}
