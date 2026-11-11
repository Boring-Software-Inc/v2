import {
	type AllowlistEntry,
	type AllowlistEntryInput,
	allowlistAccountIdSchema,
	allowlistEntryInputSchema,
	DEFAULT_ORG_MODERATION_POLICY,
	DEFAULT_REPO_MODERATION_POLICY,
	type EffectiveRepoModerationPolicy,
	type ModerationOutcome,
	type ModerationSubject,
	moderationOutcomeSchema,
	moderationSubjectSchema,
	type OrgModerationPolicy,
	orgModerationPolicySchema,
	type RepoModerationPolicy,
	type RepoModerationPolicyPatch,
	repoModerationPolicyPatchSchema,
	repoModerationPolicySchema,
	SHARED_BLOCKLIST_RULE_ID,
} from "@tripwire/contracts";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
	organizationModerationPolicies,
	repositoryAllowlistEntries,
	repositoryModerationPolicies,
} from "../schema/moderation-policy.ts";
import { organization } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import type { DbLike } from "./access.ts";

export async function getOrgPolicy(
	db: DbLike,
	orgId: string,
): Promise<OrgModerationPolicy> {
	const [row] = await db
		.select({ policy: organizationModerationPolicies.policy })
		.from(organizationModerationPolicies)
		.where(eq(organizationModerationPolicies.organizationId, orgId));
	return row
		? orgModerationPolicySchema.parse(row.policy)
		: DEFAULT_ORG_MODERATION_POLICY;
}

export async function upsertOrgPolicy(
	db: DbLike,
	orgId: string,
	config: OrgModerationPolicy,
): Promise<void> {
	const policy = orgModerationPolicySchema.parse(config);
	await db
		.insert(organizationModerationPolicies)
		.values({ organizationId: orgId, policy })
		.onConflictDoUpdate({
			target: organizationModerationPolicies.organizationId,
			set: { policy, updatedAt: new Date() },
		});
}

export async function updateOrgDefault(
	db: Db,
	orgId: string,
	subjectInput: ModerationSubject,
	outcomeInput: ModerationOutcome,
): Promise<OrgModerationPolicy> {
	const subject = moderationSubjectSchema.parse(subjectInput);
	const outcome = moderationOutcomeSchema.parse(outcomeInput);
	return await db.transaction(async (tx) => {
		const [org] = await tx
			.select({ id: organization.id })
			.from(organization)
			.where(eq(organization.id, orgId))
			.for("update");
		if (!org) throw new Error("Organization unavailable");

		const current = await getOrgPolicy(tx, orgId);
		const next = { defaults: { ...current.defaults, [subject]: outcome } };
		await upsertOrgPolicy(tx, orgId, next);
		return next;
	});
}

export async function getRepoPolicy(
	db: DbLike,
	repoId: string,
): Promise<RepoModerationPolicy> {
	const [row] = await db
		.select({ policy: repositoryModerationPolicies.policy })
		.from(repositoryModerationPolicies)
		.where(eq(repositoryModerationPolicies.repoId, repoId));
	return row
		? repoModerationPolicySchema.parse(row.policy)
		: DEFAULT_REPO_MODERATION_POLICY;
}

export async function getEffectiveRepoPolicy(
	db: DbLike,
	repoId: string,
): Promise<EffectiveRepoModerationPolicy> {
	const [row] = await db
		.select({
			repoPolicy: repositoryModerationPolicies.policy,
			orgPolicy: organizationModerationPolicies.policy,
		})
		.from(repos)
		.leftJoin(
			repositoryModerationPolicies,
			eq(repositoryModerationPolicies.repoId, repos.id),
		)
		.leftJoin(
			organizationModerationPolicies,
			eq(organizationModerationPolicies.organizationId, repos.orgId),
		)
		.where(eq(repos.id, repoId));
	const repoPolicy = row?.repoPolicy
		? repoModerationPolicySchema.parse(row.repoPolicy)
		: DEFAULT_REPO_MODERATION_POLICY;
	const orgPolicy = row?.orgPolicy
		? orgModerationPolicySchema.parse(row.orgPolicy)
		: DEFAULT_ORG_MODERATION_POLICY;
	return {
		...repoPolicy,
		defaults: { ...orgPolicy.defaults, ...repoPolicy.defaults },
	};
}

/** An absent Pilot override keeps its existing standalone PR review behavior. */
export function resolveRuleOutcome(
	policy: EffectiveRepoModerationPolicy,
	ruleId: string,
	subject: ModerationSubject,
): ModerationOutcome {
	const override = Object.hasOwn(policy.ruleOutcomes, ruleId)
		? policy.ruleOutcomes[ruleId]?.[subject]
		: undefined;
	if (override && override !== "inherit") return override;
	if (
		override === undefined &&
		ruleId === SHARED_BLOCKLIST_RULE_ID &&
		subject === "change-request"
	) {
		return "human-review";
	}
	return policy.defaults[subject];
}

export async function upsertRepoPolicy(
	db: DbLike,
	repoId: string,
	config: RepoModerationPolicy,
): Promise<void> {
	const policy = repoModerationPolicySchema.parse(config);
	await db
		.insert(repositoryModerationPolicies)
		.values({ repoId, policy })
		.onConflictDoUpdate({
			target: repositoryModerationPolicies.repoId,
			set: { policy, updatedAt: new Date() },
		});
}

export async function updateRepoPolicy(
	db: Db,
	repoId: string,
	input: RepoModerationPolicyPatch,
): Promise<RepoModerationPolicy> {
	const patch = repoModerationPolicyPatchSchema.parse(input);
	return await db.transaction(async (tx) => {
		/** Lock the repo so concurrent edits merge even before its policy exists. */
		const [repo] = await tx
			.select({ id: repos.id })
			.from(repos)
			.where(and(eq(repos.id, repoId), isNull(repos.removedAt)))
			.for("update");
		if (!repo) throw new Error("Repository unavailable");

		const current = await getRepoPolicy(tx, repoId);
		const defaults = { ...current.defaults };
		for (const subject of ["issue", "change-request"] as const) {
			const outcome = patch.defaults?.[subject];
			if (outcome === null) delete defaults[subject];
			else if (outcome !== undefined) defaults[subject] = outcome;
		}

		const ruleOutcomes = { ...current.ruleOutcomes };
		if (patch.ruleOutcome) {
			const { ruleId, subject, outcome } = patch.ruleOutcome;
			const overrides = { ...ruleOutcomes[ruleId] };
			if (outcome === null) delete overrides[subject];
			else overrides[subject] = outcome;

			if (Object.keys(overrides).length > 0) ruleOutcomes[ruleId] = overrides;
			else delete ruleOutcomes[ruleId];
		}

		const next = {
			defaults,
			ruleOutcomes,
			issueRulesEnabled: patch.issueRulesEnabled ?? current.issueRulesEnabled,
		};
		await upsertRepoPolicy(tx, repoId, next);
		return next;
	});
}

export async function listAllowlistEntries(
	db: DbLike,
	repoId: string,
): Promise<AllowlistEntry[]> {
	const rows = await db
		.select({
			accountId: repositoryAllowlistEntries.accountId,
			login: repositoryAllowlistEntries.login,
			createdAt: repositoryAllowlistEntries.createdAt,
		})
		.from(repositoryAllowlistEntries)
		.where(eq(repositoryAllowlistEntries.repoId, repoId))
		.orderBy(
			asc(repositoryAllowlistEntries.login),
			asc(repositoryAllowlistEntries.accountId),
		);
	return rows.map((row) => ({
		...row,
		createdAt: row.createdAt.toISOString(),
	}));
}

export async function addAllowlistEntry(
	db: DbLike,
	repoId: string,
	entry: AllowlistEntryInput,
): Promise<void> {
	const account = allowlistEntryInputSchema.parse(entry);
	const [repo] = await db
		.select({ id: repos.id })
		.from(repos)
		.where(
			and(
				eq(repos.id, repoId),
				eq(repos.forge, "github"),
				isNull(repos.removedAt),
			),
		);
	if (!repo) throw new Error("A connected GitHub repository is required");
	await db
		.insert(repositoryAllowlistEntries)
		.values({ repoId, ...account })
		.onConflictDoUpdate({
			target: [
				repositoryAllowlistEntries.repoId,
				repositoryAllowlistEntries.accountId,
			],
			set: { login: account.login },
		});
}

export async function removeAllowlistEntry(
	db: DbLike,
	repoId: string,
	accountId: string,
): Promise<void> {
	await db
		.delete(repositoryAllowlistEntries)
		.where(allowlistEntryScope(repoId, accountId));
}

function allowlistEntryScope(repoId: string, accountId: string) {
	return and(
		eq(repositoryAllowlistEntries.repoId, repoId),
		eq(
			repositoryAllowlistEntries.accountId,
			allowlistAccountIdSchema.parse(accountId),
		),
	);
}

export async function isAuthorAllowlisted(
	db: DbLike,
	repoId: string,
	accountId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ accountId: repositoryAllowlistEntries.accountId })
		.from(repositoryAllowlistEntries)
		.where(allowlistEntryScope(repoId, accountId));
	return row !== undefined;
}
