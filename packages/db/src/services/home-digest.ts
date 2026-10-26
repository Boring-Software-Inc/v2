import {
	type DigestRepo,
	digestRepoSchema,
	sameSettings,
	verdictSchema,
} from "@tripwire/contracts";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import { listOrgSwitcherRepos } from "./organizations.ts";
import { getRulePreview } from "./rule-previews.ts";
import { listRuleViews } from "./rules.ts";
import { runBearsVerdict } from "./runs.ts";

const countRowSchema = z.object({
	repoId: z.string(),
	verdict: verdictSchema,
	count: z.coerce.number().int().nonnegative(),
});
const latestRowSchema = z.object({
	repoId: z.string(),
	number: z.number().int(),
	verdict: verdictSchema.nullable(),
	createdAt: z.coerce.date().transform((date) => date.toISOString()),
});

export async function loadHomeDigestRepos(
	db: Db,
	orgId: string,
	from: Date,
	to: Date,
	includeReplay = true,
): Promise<DigestRepo[]> {
	const [repos, counts, latest] = await Promise.all([
		listOrgSwitcherRepos(db, orgId),
		db.execute(sql`
			SELECT r.id AS "repoId", runs.verdict, count(*)::int AS count
			FROM repos r JOIN runs ON runs.repo_full_name = r.full_name
			JOIN events e ON e.id = runs.event_id AND e.forge = r.forge
			WHERE r.org_id = ${orgId} AND r.removed_at IS NULL
			  AND runs.created_at >= ${from.toISOString()} AND runs.created_at <= ${to.toISOString()}
			  AND runs.verdict IS NOT NULL AND ${runBearsVerdict}
			GROUP BY r.id, runs.verdict`),
		db.execute(sql`
			SELECT DISTINCT ON (r.id, runs.subject_number)
			  r.id AS "repoId", runs.subject_number AS number, runs.verdict, runs.created_at AS "createdAt"
			FROM repos r JOIN runs ON runs.repo_full_name = r.full_name
			JOIN events e ON e.id = runs.event_id AND e.forge = r.forge
			WHERE r.org_id = ${orgId} AND r.removed_at IS NULL
			  AND runs.subject_kind IS NULL AND runs.subject_number IS NOT NULL
			  AND runs.created_at >= ${from.toISOString()} AND runs.created_at <= ${to.toISOString()}
			  AND ${runBearsVerdict}
			ORDER BY r.id, runs.subject_number, runs.event_id DESC, runs.created_at DESC, runs.id DESC`),
	]);
	const countRows = z.array(countRowSchema).parse(counts.rows);
	const latestRows = z.array(latestRowSchema).parse(latest.rows);
	return await Promise.all(
		repos.map(async (repo) => {
			const canReplay =
				includeReplay &&
				latestRows.some(
					(row) => row.repoId === repo.id && row.verdict === "pass",
				);
			const [stored, rules] = await Promise.all([
				canReplay ? getRulePreview(db, repo.id) : null,
				canReplay ? listRuleViews(db, repo.id) : [],
			]);
			return digestRepoSchema.parse({
				id: repo.id,
				name: repo.name,
				fullName: repo.fullName,
				counts: countRows.filter((row) => row.repoId === repo.id),
				latestRuns: latestRows.filter((row) => row.repoId === repo.id),
				preview: stored?.preview ?? null,
				uninstalledRuleIds: rules
					.filter(
						(rule) =>
							!rule.enabled &&
							rule.source === "built-in" &&
							rule.management === "standalone" &&
							rule.forgeBlockReason === null &&
							rule.unavailableReason === null &&
							sameSettings(rule.config, rule.defaultConfig),
					)
					.map((rule) => rule.ruleId),
			});
		}),
	);
}
