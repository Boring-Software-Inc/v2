import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import {
	organizationInstallations,
	organizationResponseDefaults,
} from "../schema/organizations.ts";
import {
	customRules,
	repos,
	responseConfigs,
	ruleConfigs,
	workflowDefinitions,
} from "../schema/repos.ts";
import { runs } from "../schema/runs.ts";

export interface RepoSetupFacts {
	installed: boolean;
	armed: boolean;
	enabledRuleIds: string[];
	customRulesOn: number;
	workflowsOn: number;
	firstCheck: { number: number; at: string } | null;
	nextChangeRequest: number | null;
	responsesChosen: boolean;
}

const openRowSchema = z.object({ subject_number: z.coerce.number().int() });

export async function latestOpenChangeRequest(
	db: Db,
	repo: { fullName: string; forge: string },
): Promise<number | null> {
	const result = await db.execute(sql`
		SELECT subject_number
		FROM events
		WHERE repo_full_name = ${repo.fullName}
		  AND forge = ${repo.forge}
		  AND subject_number IS NOT NULL
		  AND normalized_at IS NOT NULL
		  AND kind IN ('change-request.opened', 'change-request.updated', 'change-request.closed')
		GROUP BY subject_number
		HAVING max(received_at) FILTER (WHERE kind = 'change-request.opened')
		     > coalesce(
		         max(received_at) FILTER (WHERE kind = 'change-request.closed'),
		         '-infinity'::timestamptz
		       )
		ORDER BY max(received_at) DESC
		LIMIT 1`);
	const row = openRowSchema.safeParse(result.rows[0]);
	return row.success ? row.data.subject_number : null;
}

export async function getRepoSetupFacts(
	db: Db,
	input: { orgId: string; repoId: string },
): Promise<RepoSetupFacts | null> {
	const repoRows = await db
		.select()
		.from(repos)
		.where(
			and(
				eq(repos.id, input.repoId),
				eq(repos.orgId, input.orgId),
				isNull(repos.removedAt),
			),
		)
		.limit(1);
	const repo = repoRows[0];
	if (!repo) {
		return null;
	}
	const [
		installs,
		rules,
		custom,
		workflows,
		checks,
		nextChangeRequest,
		repoResponses,
		orgResponses,
	] = await Promise.all([
		repo.installationId
			? db
					.select({ id: organizationInstallations.id })
					.from(organizationInstallations)
					.where(
						and(
							eq(organizationInstallations.organizationId, input.orgId),
							eq(organizationInstallations.forge, repo.forge),
							eq(organizationInstallations.installationId, repo.installationId),
						),
					)
					.limit(1)
			: Promise.resolve([]),
		db
			.select({ ruleId: ruleConfigs.ruleId })
			.from(ruleConfigs)
			.where(
				and(eq(ruleConfigs.repoId, repo.id), eq(ruleConfigs.enabled, true)),
			),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(customRules)
			.where(
				and(eq(customRules.repoId, repo.id), eq(customRules.enabled, true)),
			),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(workflowDefinitions)
			.where(
				and(
					eq(workflowDefinitions.repoId, repo.id),
					eq(workflowDefinitions.enabled, true),
				),
			),
		db
			.select({ number: runs.subjectNumber, at: runs.createdAt })
			.from(runs)
			.where(
				and(
					eq(runs.repoFullName, repo.fullName),
					isNotNull(runs.subjectNumber),
					isNull(runs.subjectKind),
					eq(runs.backfill, false),
					eq(runs.status, "completed"),
				),
			)
			.orderBy(asc(runs.createdAt))
			.limit(1),
		latestOpenChangeRequest(db, repo),
		db
			.select({ id: responseConfigs.id })
			.from(responseConfigs)
			.where(eq(responseConfigs.repoId, repo.id))
			.limit(1),
		db
			.select({ id: organizationResponseDefaults.id })
			.from(organizationResponseDefaults)
			.where(eq(organizationResponseDefaults.organizationId, input.orgId))
			.limit(1),
	]);
	const check = checks[0];
	return {
		installed: installs.length > 0,
		armed: repo.armed,
		enabledRuleIds: rules.map((rule) => rule.ruleId).sort(),
		customRulesOn: Number(custom[0]?.n ?? 0),
		workflowsOn: Number(workflows[0]?.n ?? 0),
		firstCheck:
			check?.number != null
				? { number: check.number, at: check.at.toISOString() }
				: null,
		nextChangeRequest,
		responsesChosen: repoResponses.length > 0 || orgResponses.length > 0,
	};
}
