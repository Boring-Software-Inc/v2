import {
	type CustomRuleRecord,
	customRuleRecordSchema,
	GATE_CATALOG,
	orgSlugSchema,
	RULE_CATALOG,
	responseConfigSchema,
	TRIGGER_CATALOG,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client.ts";
import { account, user } from "./schema/auth.ts";
import { events } from "./schema/events.ts";
import { member, organization } from "./schema/organizations.ts";
import {
	DEMO_EMAIL_DOMAIN,
	DEMO_TEAM_SLUG,
	ensureDemoRepo,
	seedStory,
} from "./seed.ts";
import * as economicsServices from "./services/economics.ts";
import * as insightServices from "./services/insights.ts";
import * as orgServices from "./services/organizations.ts";
import * as repoServices from "./services/repos.ts";
import * as reviewerServices from "./services/reviewers.ts";
import * as workflowServices from "./services/workflows.ts";

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

const REVIEWERS = [
	{ id: 91_000_001, login: "sam-okafor", permission: "admin" },
	{ id: 91_000_002, login: "rin-takeda", permission: "maintain" },
	{ id: 91_000_003, login: "lena-vogt", permission: "write" },
	{ id: 91_000_004, login: "theo-marsh", permission: "write" },
	{ id: 91_000_005, login: "priya-raman", permission: "write" },
].map((reviewer) => ({ ...reviewer, avatarUrl: "" }));

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
	const seeded = await db.execute(
		sql`SELECT 1 FROM response_configs WHERE repo_id = ${repoId} LIMIT 1`,
	);
	if (seeded.rows.length > 0) {
		return;
	}
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
	await reviewerServices.replaceRepoReviewers(db, repoId, REVIEWERS);
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
		await seedRepoExtras(db, repo.id);
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
	const seeded = await db.execute(
		sql`SELECT 1 FROM usage_counters WHERE org_id = ${input.orgId} LIMIT 1`,
	);
	if (seeded.rows.length > 0) {
		return;
	}
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

const CHANGE_REQUEST_KINDS = [
	"change-request.opened",
	"change-request.updated",
];

function catalogWorkflow(
	name: string,
	kinds: string[],
	middle: object[],
	edges: object[],
): WorkflowDefinition {
	return workflowDefinitionSchema.parse({
		id: generateId(),
		name,
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds, position: { x: 80, y: 160 } },
			...middle,
			{
				id: "block",
				type: "action",
				action: "block",
				position: { x: 640, y: 160 },
			},
		],
		edges,
	});
}

function cryptoBlocks(name: string, kinds: string[]): WorkflowDefinition {
	return catalogWorkflow(
		name,
		kinds,
		[
			{
				id: "r",
				type: "rule",
				ref: "crypto-address@1",
				config: {},
				position: { x: 360, y: 160 },
			},
		],
		[
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "block", when: "fail" },
		],
	);
}

function workflowCatalog(): WorkflowDefinition[] {
	const rules = RULE_CATALOG.map((rule) =>
		catalogWorkflow(
			`rule: ${rule.name}`,
			CHANGE_REQUEST_KINDS,
			[
				{
					id: "r",
					type: "rule",
					ref: `${rule.ruleId}@${rule.version}`,
					config: structuredClone(rule.defaultConfig),
					position: { x: 360, y: 160 },
				},
			],
			[
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "block", when: "fail" },
			],
		),
	);
	const gates = GATE_CATALOG.map((gate) => {
		const two = gate.mode !== "not";
		const second = two
			? [
					{
						id: "r2",
						type: "rule",
						ref: "account-age@1",
						config: { minDays: 7 },
						position: { x: 340, y: 240 },
					},
				]
			: [];
		const secondEdges = two
			? [
					{ id: "e2", from: "t", to: "r2" },
					{ id: "e3", from: "r2", to: "g" },
				]
			: [];
		return catalogWorkflow(
			`gate: ${gate.name}`,
			CHANGE_REQUEST_KINDS,
			[
				{
					id: "r1",
					type: "rule",
					ref: "crypto-address@1",
					config: {},
					position: { x: 340, y: two ? 90 : 160 },
				},
				...second,
				{
					id: "g",
					type: "gate",
					mode: gate.mode,
					position: { x: 500, y: 160 },
				},
			],
			[
				{ id: "e1", from: "t", to: "r1" },
				...secondEdges,
				{ id: "e4", from: "r1", to: "g" },
				{ id: "e5", from: "g", to: "block", when: "fail" },
			],
		);
	});
	const triggers = TRIGGER_CATALOG.filter((entry) => entry.toolbox).map(
		(entry) => cryptoBlocks(`trigger: ${entry.name}`, [entry.kind]),
	);
	return [...rules, ...gates, ...triggers];
}

export async function seedWorkflowCatalog(
	db: Db,
	repoId: string,
): Promise<{ created: number; total: number }> {
	const definitions = workflowCatalog();
	const existing = new Set(
		(await workflowServices.listWorkflows(db, repoId)).map(
			(workflow) => workflow.name,
		),
	);
	let created = 0;
	for (const definition of definitions) {
		if (existing.has(definition.name)) {
			continue;
		}
		await workflowServices.createWorkflow(db, {
			repoId,
			name: definition.name,
			definition,
		});
		created++;
	}
	return { created, total: definitions.length };
}

const TEAMMATES = [
	{ id: "demo-teammate-sam", name: "Sam Okafor" },
	{ id: "demo-teammate-rin", name: "Rin Takeda" },
];

export async function ensureDemoTeammates(db: Db): Promise<string[]> {
	for (const teammate of TEAMMATES) {
		await db
			.insert(user)
			.values({
				id: teammate.id,
				name: teammate.name,
				email: `${teammate.id}@${DEMO_EMAIL_DOMAIN}`,
			})
			.onConflictDoNothing();
	}
	return TEAMMATES.map((teammate) => teammate.id);
}

export async function seedActivePersonaExtras(
	db: Db,
	input: {
		userId: string;
		orgId: string;
		repo: { id: string; fullName: string };
		now: Date;
	},
): Promise<void> {
	await seedRepoExtras(db, input.repo.id);
	await seedWorkflowCatalog(db, input.repo.id);
	await seedTeamOrg(db, {
		adminUserId: input.userId,
		memberUserIds: await ensureDemoTeammates(db),
		now: input.now,
	});
	await seedApprovedInstallRequest(db, {
		userId: input.userId,
		now: input.now,
	});
	await seedEconomics(db, {
		orgId: input.orgId,
		repoFullName: input.repo.fullName,
		now: input.now,
		days: 30,
	});
}
