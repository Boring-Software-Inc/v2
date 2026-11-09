import { type Db, repoServices } from "@tripwire/db";

/**
 * Pin the sacrificial repo's rule_configs to exactly what a scenario needs,
 * then restore the maintainer's real config on exit. A scenario says which
 * rules are ON; every other known rule is forced OFF so a stray opt-in can't
 * change the verdict. Baseline rules with no row still run — so "off" must be
 * written explicitly, never omitted.
 */

export type RuleConfigRow = repoServices.RuleConfigRow;

/** Every rule the harness knows to force-disable when isolating one. */
const KNOWN_RULES: RuleConfigRow[] = [
	{ ruleId: "account-age", version: 1, enabled: false, config: { minDays: 7 } },
	{ ruleId: "crypto-address", version: 1, enabled: false, config: {} },
	{
		ruleId: "english-only",
		version: 1,
		enabled: false,
		config: { maxNonLatinRatio: 0.5 },
	},
	{
		ruleId: "honeypot",
		version: 1,
		enabled: false,
		config: { paths: [".github/workflows/**"] },
	},
	{
		ruleId: "max-files-changed",
		version: 1,
		enabled: false,
		config: { max: 200 },
	},
	{ ruleId: "min-merged-prs", version: 1, enabled: false, config: { min: 0 } },
	{
		ruleId: "pr-rate-limit",
		version: 1,
		enabled: false,
		config: { windowHours: 24, maxPerWindow: 5 },
	},
	{
		ruleId: "profile-readme",
		version: 1,
		enabled: false,
		config: { minLength: 32 },
	},
	{ ruleId: "ai-review", version: 1, enabled: false, config: { maxSteps: 12 } },
];

export interface RuleConfigSnapshot {
	repoId: string;
	prior: RuleConfigRow[];
}

/**
 * Enable exactly `enable` (overriding config), force every other KNOWN rule
 * off, and snapshot the prior state for restore. Returns the snapshot + repoId.
 */
export async function pinRules(
	db: Db,
	repoFullName: string,
	enable: RuleConfigRow[],
): Promise<RuleConfigSnapshot> {
	const repo = await repoServices.getRepoByFullName(db, repoFullName, "github");
	if (!repo) {
		throw new Error(
			`repo ${repoFullName} is not in the DB — is the app installed and has a webhook landed?`,
		);
	}
	const prior = await repoServices.listRuleConfigs(db, repo.id);
	const enabledIds = new Set(enable.map((r) => r.ruleId));

	for (const row of enable) {
		await repoServices.upsertRuleConfig(db, repo.id, row);
	}
	for (const row of KNOWN_RULES) {
		if (!enabledIds.has(row.ruleId)) {
			await repoServices.upsertRuleConfig(db, repo.id, {
				...row,
				enabled: false,
			});
		}
	}
	// Any prior opt-in not in our known set would still run — force it off too.
	for (const row of prior) {
		if (
			!enabledIds.has(row.ruleId) &&
			!KNOWN_RULES.some((k) => k.ruleId === row.ruleId)
		) {
			await repoServices.upsertRuleConfig(db, repo.id, {
				...row,
				enabled: false,
			});
		}
	}
	return { repoId: repo.id, prior };
}

export async function restoreRules(
	db: Db,
	snapshot: RuleConfigSnapshot,
): Promise<void> {
	const priorIds = new Set(snapshot.prior.map((r) => r.ruleId));
	for (const row of snapshot.prior) {
		await repoServices.upsertRuleConfig(db, snapshot.repoId, row);
	}
	// Anything we introduced that wasn't prior stays disabled (we don't delete
	// rows — the Rules UI owns creation).
	for (const row of KNOWN_RULES) {
		if (!priorIds.has(row.ruleId)) {
			await repoServices.upsertRuleConfig(db, snapshot.repoId, {
				...row,
				enabled: false,
			});
		}
	}
}
