import {
	normalizedEventSchema,
	type RepoScopedEvent,
	RULE_PREVIEW_MAX_AGE_MS,
	RULE_PREVIEW_MAX_CHANGE_REQUESTS,
	type RulePreview,
	type RuleUsage,
	rulePreviewSchema,
} from "@tripwire/contracts";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import { rulePreviews } from "../schema/repos.ts";

export interface StoredRulePreview {
	preview: RulePreview;
	computedAt: Date;
}

export interface PreviewChangeRequest {
	eventId: string;
	number: number;
	title: string;
	author: string;
	authorAssociation: string | null;
	event: RepoScopedEvent;
}

export interface PreviewStep {
	eventId: string;
	number: number;
	ref: string;
	config: unknown;
	status: "pass" | "fail" | "skipped";
	evidence: unknown;
}

export interface PreviewInputs {
	changeRequests: PreviewChangeRequest[];
	steps: PreviewStep[];
}

export async function getRulePreview(
	db: Db,
	repoId: string,
): Promise<StoredRulePreview | null> {
	const rows = await db
		.select()
		.from(rulePreviews)
		.where(eq(rulePreviews.repoId, repoId));
	const row = rows[0];
	if (!row) {
		return null;
	}
	const parsed = rulePreviewSchema.safeParse(row.preview);
	return parsed.success
		? { preview: parsed.data, computedAt: row.computedAt }
		: null;
}

export function previewNeedsRefresh(
	stored: StoredRulePreview | null,
	now: Date,
): boolean {
	return (
		stored === null ||
		now.getTime() - stored.computedAt.getTime() > RULE_PREVIEW_MAX_AGE_MS
	);
}

export async function saveRulePreview(
	db: Db,
	repoId: string,
	preview: RulePreview,
	computedAt: Date,
): Promise<void> {
	const parsed = rulePreviewSchema.parse(preview);
	await db
		.insert(rulePreviews)
		.values({ repoId, preview: parsed, computedAt })
		.onConflictDoUpdate({
			target: rulePreviews.repoId,
			set: { preview: parsed, computedAt },
		});
}

const eventRowSchema = z.object({
	id: z.string(),
	subject_number: z.coerce.number().int(),
	normalized: z.unknown(),
	association: z.string().nullable(),
});

const stepRowSchema = z.object({
	event_id: z.string(),
	subject_number: z.coerce.number().int(),
	rule_id: z.string(),
	status: z.enum(["pass", "fail", "skipped"]),
	input: z.unknown(),
	evidence: z.unknown(),
});

function innerEvidence(stored: unknown): unknown {
	if (
		stored !== null &&
		typeof stored === "object" &&
		"ruleId" in stored &&
		"evidence" in stored
	) {
		return stored.evidence;
	}
	return stored;
}

export async function loadPreviewInputs(
	db: Db,
	repo: { fullName: string; forge: string },
	since: Date,
): Promise<PreviewInputs> {
	const eventRows = await db.execute(sql`
		SELECT DISTINCT ON (subject_number) id, subject_number, normalized,
		       raw->'pull_request'->>'author_association' AS association
		FROM events
		WHERE repo_full_name = ${repo.fullName}
		  AND forge = ${repo.forge}
		  AND kind = 'change-request.opened'
		  AND quarantined = false
		  AND normalized IS NOT NULL
		  AND subject_number IS NOT NULL
		  AND received_at >= ${since.toISOString()}
		ORDER BY subject_number DESC, received_at ASC
		LIMIT ${RULE_PREVIEW_MAX_CHANGE_REQUESTS}`);
	const changeRequests: PreviewChangeRequest[] = [];
	for (const raw of eventRows.rows) {
		const row = eventRowSchema.safeParse(raw);
		if (!row.success) {
			continue;
		}
		const event = normalizedEventSchema.safeParse(row.data.normalized);
		if (!event.success || !("changeRequest" in event.data)) {
			continue;
		}
		changeRequests.push({
			eventId: row.data.id,
			number: row.data.subject_number,
			title: event.data.changeRequest.title,
			author: event.data.actor.login,
			authorAssociation: row.data.association,
			event: event.data,
		});
	}
	if (changeRequests.length === 0) {
		return { changeRequests, steps: [] };
	}
	const numbers = changeRequests.map((cr) => cr.number);
	const stepRows = await db.execute(sql`
		SELECT r.event_id, r.subject_number, s.rule_id, s.status, s.input, s.evidence
		FROM run_steps s
		JOIN runs r ON r.id = s.run_id
		WHERE r.repo_full_name = ${repo.fullName}
		  AND r.subject_kind IS NULL
		  AND r.created_at >= ${since.toISOString()}
		  AND r.subject_number IN (${sql.join(
				numbers.map((n) => sql`${n}`),
				sql`, `,
			)})
		  AND s.node_kind = 'rule'
		  AND s.rule_id IS NOT NULL
		  AND s.status IN ('pass', 'fail', 'skipped')`);
	const steps: PreviewStep[] = [];
	for (const raw of stepRows.rows) {
		const row = stepRowSchema.safeParse(raw);
		if (!row.success) {
			continue;
		}
		const input = row.data.input as { config?: unknown } | null;
		steps.push({
			eventId: row.data.event_id,
			number: row.data.subject_number,
			ref: row.data.rule_id,
			config: input?.config,
			status: row.data.status,
			evidence: innerEvidence(row.data.evidence),
		});
	}
	return { changeRequests, steps };
}

const usageRowSchema = z.object({
	rule_id: z.string(),
	n: z.coerce.number().int(),
});

export async function getRuleUsage(db: Db): Promise<RuleUsage> {
	const total = await db.execute(sql`
		SELECT count(DISTINCT c.repo_id)::int AS n
		FROM rule_configs c
		JOIN repos r ON r.id = c.repo_id
		WHERE c.enabled AND r.armed AND r.removed_at IS NULL`);
	const repos = Number((total.rows[0] as { n?: unknown } | undefined)?.n ?? 0);
	const rows = await db.execute(sql`
		SELECT c.rule_id, count(DISTINCT c.repo_id)::int AS n
		FROM rule_configs c
		JOIN repos r ON r.id = c.repo_id
		WHERE c.enabled AND r.armed AND r.removed_at IS NULL
		GROUP BY c.rule_id`);
	const byRule: Record<string, number> = {};
	for (const raw of rows.rows) {
		const row = usageRowSchema.safeParse(raw);
		if (row.success) {
			byRule[row.data.rule_id] = row.data.n;
		}
	}
	return { repos, byRule };
}
