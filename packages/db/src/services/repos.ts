import {
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.ts";
import { userInstallations } from "../schema/auth.ts";
import { repos, ruleConfigs, workflowDefinitions } from "../schema/repos.ts";

/** Repo + config persistence (§4): installation sync, config CRUD, workflows. */

export interface EnsureRepoInput {
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
	private?: boolean;
	installationId?: string | null;
}

export async function ensureRepo(db: Db, input: EnsureRepoInput) {
	const existing = await db
		.select()
		.from(repos)
		.where(and(eq(repos.forge, "github"), eq(repos.fullName, input.fullName)));
	if (existing[0]) {
		return existing[0].id;
	}
	const id = generateId();
	await db.insert(repos).values({
		id,
		forge: "github",
		externalId: input.externalId,
		owner: input.owner,
		name: input.name,
		fullName: input.fullName,
		private: input.private ?? false,
		installationId: input.installationId ?? null,
	});
	return id;
}

export interface InstallationRepoInput {
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
}

/**
 * Installation sync (§4): upsert on install/add (re-adds clear removed_at and
 * refresh the installation id), soft-delete on remove/uninstall — history
 * stays interpretable (step-2 decision).
 */
export async function syncInstallationRepos(
	db: Db,
	installationId: string,
	added: InstallationRepoInput[],
	removed: InstallationRepoInput[],
	/**
	 * The org that owns this installation (organization_installations), or
	 * null when nobody has claimed it yet — unclaimed repos keep NULL org_id
	 * and stay invisible to org-scoped queries until the claim screen binds
	 * them (§10: never auto-attach on a guess).
	 */
	orgId: string | null = null,
): Promise<void> {
	for (const repo of added) {
		await db
			.insert(repos)
			.values({
				id: generateId(),
				forge: "github",
				externalId: repo.externalId,
				owner: repo.owner,
				name: repo.name,
				fullName: repo.fullName,
				private: repo.private,
				installationId,
				orgId,
			})
			.onConflictDoUpdate({
				target: [repos.forge, repos.externalId],
				set: {
					owner: repo.owner,
					name: repo.name,
					fullName: repo.fullName,
					private: repo.private,
					installationId,
					...(orgId ? { orgId } : {}),
					removedAt: null,
				},
			});
	}
	for (const repo of removed) {
		await db
			.update(repos)
			.set({ removedAt: new Date() })
			.where(
				and(eq(repos.forge, "github"), eq(repos.externalId, repo.externalId)),
			);
	}
}

/**
 * Uninstall: soft-delete every repo the installation granted AND drop the
 * `user_installations` link. Repos keep their history (soft-delete); the link is
 * a live-ownership pointer, so it must go — otherwise `hasInstallation` stays
 * true with zero repos and onboarding is stuck on the "syncing…" spinner with no
 * install button, unable to reinstall. Reinstalling issues a fresh installation
 * id and re-links cleanly.
 */
export async function removeInstallation(
	db: Db,
	installationId: string,
): Promise<void> {
	await db
		.update(repos)
		.set({ removedAt: new Date() })
		.where(
			and(eq(repos.forge, "github"), eq(repos.installationId, installationId)),
		);
	await db
		.delete(userInstallations)
		.where(
			and(
				eq(userInstallations.forge, "github"),
				eq(userInstallations.installationId, installationId),
			),
		);
}

/** Repos visible to the dashboard — soft-deleted rows excluded. */
export async function listActiveRepos(db: Db) {
	return await db.select().from(repos).where(isNull(repos.removedAt));
}

export async function getRepoById(db: Db, repoId: string) {
	const rows = await db.select().from(repos).where(eq(repos.id, repoId));
	return rows[0] ?? null;
}

/**
 * §4 arming — the ONLY writer of `armed`. Arming is always an explicit act
 * (the Unit 2 ARM button, or tests); installation sync and `ensureRepo` never
 * touch it, so a re-sync/reinstall preserves the maintainer's choice.
 */
export async function setRepoArmed(
	db: Db,
	repoId: string,
	armed: boolean,
): Promise<void> {
	await db.update(repos).set({ armed }).where(eq(repos.id, repoId));
}

/**
 * §4 arm-time backfill progress. `null` clears it (idle / done); an object marks
 * a replay in flight so the dashboard can show "backfilling — done of total".
 */
export async function setBackfillProgress(
	db: Db,
	repoId: string,
	progress: { total: number; done: number } | null,
): Promise<void> {
	await db
		.update(repos)
		.set({
			backfillTotal: progress?.total ?? null,
			backfillDone: progress?.done ?? null,
		})
		.where(eq(repos.id, repoId));
}

export async function getRepoByFullName(db: Db, fullName: string) {
	const rows = await db
		.select()
		.from(repos)
		.where(
			and(
				eq(repos.forge, "github"),
				eq(repos.fullName, fullName),
				isNull(repos.removedAt),
			),
		);
	return rows[0] ?? null;
}

/** Enabled workflow definitions for a repo, contracts-validated on read. */
export async function listEnabledWorkflows(
	db: Db,
	repoFullName: string,
): Promise<WorkflowDefinition[]> {
	const repo = await getRepoByFullName(db, repoFullName);
	if (!repo) {
		return [];
	}
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(
			and(
				eq(workflowDefinitions.repoId, repo.id),
				eq(workflowDefinitions.enabled, true),
			),
		);
	return rows.map((row) => workflowDefinitionSchema.parse(row.definition));
}

/**
 * Does the repo have a saved, enabled workflow? When true, the /rules toggles
 * are a kill switch over that graph (not a derived default) — the UI shows a
 * "managed by your workflow" tag (§6).
 */
export async function hasEnabledWorkflow(
	db: Db,
	repoId: string,
): Promise<boolean> {
	const rows = await db
		.select({ id: workflowDefinitions.id })
		.from(workflowDefinitions)
		.where(
			and(
				eq(workflowDefinitions.repoId, repoId),
				eq(workflowDefinitions.enabled, true),
			),
		)
		.limit(1);
	return rows.length > 0;
}

export async function saveWorkflowDefinition(
	db: Db,
	repoId: string,
	definition: WorkflowDefinition,
): Promise<string> {
	const valid = workflowDefinitionSchema.parse(definition);
	const existing = await db
		.select()
		.from(workflowDefinitions)
		.where(eq(workflowDefinitions.repoId, repoId));
	const match = existing.find(
		(row) => (row.definition as WorkflowDefinition).id === valid.id,
	);
	if (match) {
		await db
			.update(workflowDefinitions)
			.set({ definition: valid, name: valid.name, updatedAt: new Date() })
			.where(eq(workflowDefinitions.id, match.id));
		return match.id;
	}
	const id = generateId();
	await db.insert(workflowDefinitions).values({
		id,
		repoId,
		name: valid.name,
		definition: valid,
	});
	return id;
}

export interface RuleConfigRow {
	ruleId: string;
	version: number;
	enabled: boolean;
	config: unknown;
}

export async function listRuleConfigs(
	db: Db,
	repoId: string,
): Promise<RuleConfigRow[]> {
	const rows = await db
		.select()
		.from(ruleConfigs)
		.where(eq(ruleConfigs.repoId, repoId));
	return rows.map((row) => ({
		ruleId: row.ruleId,
		version: row.version,
		enabled: row.enabled,
		config: row.config,
	}));
}

export async function upsertRuleConfig(
	db: Db,
	repoId: string,
	input: RuleConfigRow,
): Promise<void> {
	await db
		.insert(ruleConfigs)
		.values({
			id: generateId(),
			repoId,
			ruleId: input.ruleId,
			version: input.version,
			enabled: input.enabled,
			config: input.config,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [ruleConfigs.repoId, ruleConfigs.ruleId],
			set: {
				version: input.version,
				enabled: input.enabled,
				config: input.config,
				updatedAt: new Date(),
			},
		});
}
