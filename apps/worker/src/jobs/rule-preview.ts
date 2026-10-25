import {
	type Forge,
	RULE_CATALOG,
	RULE_PREVIEW_MAX_EXAMPLES,
	RULE_PREVIEW_WINDOW_DAYS,
	type RulePreview,
	type RulePreviewCatch,
	type RulePreviewRule,
	ruleSupportsForge,
} from "@tripwire/contracts";
import { evaluateRule, getRule, projectRulePublic } from "@tripwire/core";
import {
	type Db,
	type PreviewInputs,
	type RulePreviewJob,
	repoServices,
	rulePreviewServices,
} from "@tripwire/db";
import type { Logger } from "pino";

const DAY_MS = 86_400_000;

const EXEMPT_ASSOCIATIONS: ReadonlySet<string> = new Set([
	"OWNER",
	"MEMBER",
	"COLLABORATOR",
]);

export const EVENT_ONLY_RULE_IDS: ReadonlySet<string> = new Set([
	"english-only",
]);

function sameConfig(
	schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
	stored: unknown,
	expected: unknown,
): boolean {
	const parsed = schema.safeParse(stored);
	return (
		parsed.success && JSON.stringify(parsed.data) === JSON.stringify(expected)
	);
}

async function previewRule(
	entry: (typeof RULE_CATALOG)[number],
	inputs: PreviewInputs,
	forge: Forge,
	now: string,
): Promise<RulePreviewRule> {
	const ref = `${entry.ruleId}@${entry.version}`;
	const rule = getRule(ref);
	const unknown: RulePreviewRule = {
		ruleId: entry.ruleId,
		caught: null,
		examples: [],
	};
	if (!rule || !ruleSupportsForge(entry.ruleId, forge)) {
		return unknown;
	}
	const defaults = rule.configSchema.safeParse(entry.defaultConfig);
	if (!defaults.success) {
		return unknown;
	}
	const caught: RulePreviewCatch[] = [];
	for (const cr of inputs.changeRequests) {
		if (EVENT_ONLY_RULE_IDS.has(entry.ruleId)) {
			const result = await evaluateRule(
				rule,
				{ event: cr.event, now, diff: null, commits: null, contributor: null },
				defaults.data,
			);
			if (result.status === "evaluated" && !result.passed) {
				caught.push({
					number: cr.number,
					title: cr.title,
					author: cr.author,
					reason: projectRulePublic(ref, result.evidence, false).summary,
				});
			}
			continue;
		}
		const steps = inputs.steps.filter(
			(step) =>
				step.number === cr.number &&
				step.ref === ref &&
				step.status !== "skipped" &&
				sameConfig(rule.configSchema, step.config, defaults.data),
		);
		const failed = steps.find((step) => step.status === "fail");
		if (failed) {
			caught.push({
				number: cr.number,
				title: cr.title,
				author: cr.author,
				reason: failed.summary,
			});
			continue;
		}
		if (steps.length === 0) {
			return unknown;
		}
	}
	return {
		ruleId: entry.ruleId,
		caught: caught.map((c) => c.number),
		examples: caught.slice(0, RULE_PREVIEW_MAX_EXAMPLES),
	};
}

export function outsideContributors(inputs: PreviewInputs): PreviewInputs {
	return {
		changeRequests: inputs.changeRequests.filter(
			(cr) =>
				cr.authorAssociation === null ||
				!EXEMPT_ASSOCIATIONS.has(cr.authorAssociation),
		),
		steps: inputs.steps,
	};
}

export async function computeRulePreview(
	inputs: PreviewInputs,
	forge: Forge,
	now: Date,
): Promise<RulePreview> {
	const rules: RulePreviewRule[] = [];
	for (const entry of RULE_CATALOG) {
		rules.push(await previewRule(entry, inputs, forge, now.toISOString()));
	}
	return {
		windowDays: RULE_PREVIEW_WINDOW_DAYS,
		changeRequests: inputs.changeRequests.length,
		rules,
	};
}

export interface RulePreviewDeps {
	db: Db;
	logger: Logger;
	now?: () => Date;
}

export async function refreshRulePreview(
	deps: RulePreviewDeps,
	job: RulePreviewJob,
): Promise<void> {
	const { db, logger } = deps;
	const now = deps.now?.() ?? new Date();
	const repo = await repoServices.getRepoById(db, job.repoId);
	if (!repo || repo.removedAt) {
		logger.info({ repoId: job.repoId }, "rule preview skipped: no repo");
		return;
	}
	const since = new Date(now.getTime() - RULE_PREVIEW_WINDOW_DAYS * DAY_MS);
	const loaded = await rulePreviewServices.loadPreviewInputs(
		db,
		{ fullName: repo.fullName, forge: repo.forge },
		since,
	);
	const preview = await computeRulePreview(
		outsideContributors(loaded),
		repo.forge,
		now,
	);
	await rulePreviewServices.saveRulePreview(db, repo.id, preview, now);
}
