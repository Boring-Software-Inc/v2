import {
	type CustomRuleRecord,
	customRuleRecordSchema,
	orgSlugSchema,
	RULE_CATALOG,
	responseConfigSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client.ts";
import { account } from "./schema/auth.ts";
import { events } from "./schema/events.ts";
import { member, organization } from "./schema/organizations.ts";
import { DEMO_TEAM_SLUG, ensureDemoRepo, seedStory } from "./seed.ts";
import * as economicsServices from "./services/economics.ts";
import * as insightServices from "./services/insights.ts";
import * as orgServices from "./services/organizations.ts";
import * as repoServices from "./services/repos.ts";

const DAY = 24 * 60 * 60 * 1000;

const ENABLED_RULES = new Set([
	"account-age",
	"min-merged-prs",
	"crypto-address",
	"honeypot",
	"english-only",
	"max-files-changed",
]);

const CUSTOM_RULES: CustomRuleRecord[] = [
	{
		id: "custom-fork-spray",
		name: "Fork spray",
		enabled: true,
		definition: {
			when: {
				id: "contributor.recentForkTimes",
				transform: { kind: "lastCount", window: "24h" },
			},
			comparison: { kind: "atMost", args: [20] },
			severity: "high",
		},
	},
	{
		id: "custom-thin-following",
		name: "Thin following",
		enabled: false,
		definition: {
			when: { id: "contributor.followers" },
			comparison: { kind: "atLeast", args: [3] },
			severity: "low",
		},
	},
];

const BRANCHES = ["main", "develop", "release/2026-10", "docs"];

const PENDING_INSTALL = {
	installationId: "demo-inst-pending",
	account: "acme-labs",
	repos: ["pending-api", "pending-docs"],
};

function isoDay(at: Date): string {
	return at.toISOString().slice(0, 10);
}

function daysBack(now: Date, days: number): string[] {
	return Array.from({ length: days }, (_, back) =>
		isoDay(new Date(now.getTime() - back * DAY)),
	);
}

function latestRuleVersions() {
	const latest = new Map<string, (typeof RULE_CATALOG)[number]>();
	for (const entry of RULE_CATALOG) {
		const seen = latest.get(entry.ruleId);
		if (!seen || entry.version > seen.version) {
			latest.set(entry.ruleId, entry);
		}
	}
	return [...latest.values()];
}

export async function seedRepoExtras(db: Db, repoId: string): Promise<void> {
	for (const entry of latestRuleVersions()) {
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: entry.ruleId,
			version: entry.version,
			enabled: ENABLED_RULES.has(entry.ruleId),
			config: entry.defaultConfig,
		});
	}
	for (const rule of CUSTOM_RULES) {
		await repoServices.upsertCustomRule(
			db,
			repoId,
			customRuleRecordSchema.parse({
				...rule,
				id: `${rule.id}-${repoId.slice(-8).toLowerCase()}`,
			}),
		);
	}
	await repoServices.upsertResponseConfig(
		db,
		repoId,
		responseConfigSchema.parse({
			blockComment: { mode: "one-liner-link", showRuleName: true },
			reviewComment: { showDetailsButton: true },
		}),
	);
	await repoServices.upsertRepoSuggestions(db, repoId, "branches", BRANCHES);
}

const TEAM = {
	slug: DEMO_TEAM_SLUG,
	name: "Demo team",
	installationId: "demo-inst-team",
	repos: ["team-api", "team-web"],
};

export async function seedTeamOrg(
	db: Db,
	input: { adminUserId: string; memberUserIds: string[]; now: Date },
): Promise<{ id: string; slug: string }> {
	const slug = orgSlugSchema.parse(TEAM.slug);
	const [found] = await db
		.select({ id: organization.id, slug: organization.slug })
		.from(organization)
		.where(eq(organization.slug, slug));
	const org = found ?? { id: generateId(), slug };
	if (!found) {
		await db
			.insert(organization)
			.values({ id: org.id, name: TEAM.name, slug, isPersonal: false });
	}
	const roles = [
		{ userId: input.adminUserId, role: "admin" },
		...input.memberUserIds.map((userId) => ({ userId, role: "member" })),
	];
	for (const { userId, role } of roles) {
		await db
			.insert(member)
			.values({ id: generateId(), organizationId: org.id, userId, role })
			.onConflictDoNothing();
	}
	const links = await orgServices.listInviteLinks(db, org.id);
	if (links.length === 0) {
		await orgServices.createInviteLink(db, {
			orgId: org.id,
			role: "member",
			createdBy: input.adminUserId,
			maxUses: 5,
			expiresInDays: 7,
		});
	}
	for (const name of TEAM.repos) {
		const repo = await ensureDemoRepo(db, name, {
			installationId: TEAM.installationId,
		});
		await seedStory(db, repo, input.now, { days: 90 });
	}
	await orgServices.linkOrgInstallation(db, {
		orgId: org.id,
		installationId: TEAM.installationId,
		accountType: "Organization",
		accountLogin: "tripwire-demo",
	});
	return org;
}

export async function seedApprovedInstallRequest(
	db: Db,
	input: { userId: string; now: Date },
): Promise<void> {
	const requesterId = `demo-gh-${input.userId}`;
	await db
		.insert(account)
		.values({
			id: `demo-acct-gh-${input.userId}`,
			userId: input.userId,
			accountId: requesterId,
			providerId: "github",
		})
		.onConflictDoNothing();
	for (const name of PENDING_INSTALL.repos) {
		await ensureDemoRepo(db, name, {
			installationId: PENDING_INSTALL.installationId,
		});
	}
	await db
		.insert(events)
		.values({
			id: "demo-evt-install-pending",
			forge: "github",
			deliveryId: "demo-delivery-install-pending",
			rawKind: "installation",
			raw: {
				action: "created",
				installation: {
					id: PENDING_INSTALL.installationId,
					account: { login: PENDING_INSTALL.account },
				},
				requester: { id: requesterId },
			},
			receivedAt: new Date(input.now.getTime() - 2 * 60 * 60 * 1000),
			kind: "installation.created",
		})
		.onConflictDoNothing();
}

const recentRunRow = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	aiStepId: z.string().nullable(),
});

export async function seedEconomics(
	db: Db,
	input: { orgId: string; repoFullName: string; now: Date; days: number },
): Promise<void> {
	const since = new Date(input.now.getTime() - input.days * DAY);
	const result = await db.execute(sql`
		SELECT r.id,
		       r.created_at AS "createdAt",
		       (SELECT s.id FROM run_steps s
		         WHERE s.run_id = r.id AND s.rule_id LIKE 'ai-review@%'
		         LIMIT 1) AS "aiStepId"
		FROM runs r
		WHERE r.repo_full_name = ${input.repoFullName}
		  AND r.created_at >= ${since}
	`);
	const recent = z.array(recentRunRow).parse(result.rows);
	for (const [index, run] of recent.entries()) {
		const spread = (index % 7) + 1;
		await economicsServices.recordUsageCounters(db, {
			runId: run.id,
			orgId: input.orgId,
			githubApiCalls: 6 + spread * 2,
			githubBytesIn: 18_000 + spread * 4_200,
			githubBytesOut: 1_200 + spread * 160,
			openrouterBytesOut: run.aiStepId ? 9_000 + spread * 900 : 0,
			activeMs: 420 + spread * 85,
		});
		if (run.aiStepId) {
			await economicsServices.recordAiReviewUsage(db, {
				runStepId: run.aiStepId,
				runId: run.id,
				orgId: input.orgId,
				model: "anthropic/claude-sonnet-5-5",
				httpRequests: 2 + (spread % 3),
				promptTokens: 6_400 + spread * 520,
				completionTokens: 420 + spread * 64,
				cachedTokens: 2_048,
				costUsd: 0.018 + spread * 0.003,
				source: "dev",
			});
		}
	}
	for (const [back, day] of daysBack(input.now, input.days).entries()) {
		const wobble = ((back * 37) % 11) / 100;
		await economicsServices.upsertProviderCost(db, {
			day,
			provider: "railway",
			service: "web",
			usageJson: { cpuHours: 12 + (back % 5) },
			costUsd: 0.62 + wobble,
			estimated: false,
		});
		await economicsServices.upsertProviderCost(db, {
			day,
			provider: "railway",
			service: "worker",
			usageJson: { cpuHours: 9 + (back % 4) },
			costUsd: 0.48 + wobble,
			estimated: false,
		});
		await economicsServices.upsertProviderCost(db, {
			day,
			provider: "planetscale",
			service: "postgres",
			usageJson: { storageGb: 2.4 },
			costUsd: 1.29,
			estimated: true,
		});
		await economicsServices.rollupEconomicsDay(db, day);
	}
}

export async function seedRollups(
	db: Db,
	input: { now: Date; days: number },
): Promise<void> {
	for (const day of daysBack(input.now, input.days)) {
		await insightServices.computeDailyRollups(db, day);
	}
}
