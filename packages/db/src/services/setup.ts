import {
	parseSetupCommandArg,
	SETUP_RUN_CODE_LENGTH,
	SETUP_STAGES,
	type SetupProgressInput,
	type SetupRunView,
	type SetupStages,
	setupRunCodeSchema,
	setupStagesSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { agentGrants, agentSetupPrompts, setupRuns } from "../schema/oauth.ts";
import { notifyLive } from "./live-notify.ts";
import type { SwitcherRepo } from "./onboarding.ts";
import { getOrgInstallState, listOrgSwitcherRepos } from "./organizations.ts";

const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET =
	"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

type SetupRunRow = typeof setupRuns.$inferSelect;

export function generateRunCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(SETUP_RUN_CODE_LENGTH));
	let code = "";
	for (const byte of bytes) {
		code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
	}
	return code;
}

function toView(row: SetupRunRow): SetupRunView {
	const stages = setupStagesSchema.safeParse(row.stages);
	return {
		code: row.code,
		stages: stages.success ? stages.data : {},
		completedAt: row.completedAt?.toISOString() ?? null,
		lastReportAt: row.lastReportAt?.toISOString() ?? null,
	};
}

export async function getSetupRunForLive(
	db: Db,
	runId: string,
): Promise<{ orgId: string; userId: string; run: SetupRunView } | null> {
	const rows = await db
		.select()
		.from(setupRuns)
		.where(eq(setupRuns.id, runId))
		.limit(1);
	const row = rows[0];
	return row
		? { orgId: row.orgId, userId: row.userId, run: toView(row) }
		: null;
}

export async function findActiveSetupRun(
	db: Db,
	input: { orgId: string; userId: string },
): Promise<SetupRunView | null> {
	const rows = await db
		.select()
		.from(setupRuns)
		.where(
			and(
				eq(setupRuns.orgId, input.orgId),
				eq(setupRuns.userId, input.userId),
				gt(setupRuns.expiresAt, new Date()),
			),
		)
		.orderBy(desc(setupRuns.createdAt))
		.limit(1);
	const row = rows[0];
	return row ? toView(row) : null;
}

export async function ensureSetupRun(
	db: Db,
	input: { orgId: string; userId: string },
): Promise<SetupRunView> {
	const existing = await findActiveSetupRun(db, input);
	if (existing) {
		return existing;
	}
	for (let attempt = 0; attempt < 3; attempt++) {
		const inserted = await db
			.insert(setupRuns)
			.values({
				id: generateId(),
				orgId: input.orgId,
				userId: input.userId,
				code: generateRunCode(),
				stages: {},
				expiresAt: new Date(Date.now() + RUN_TTL_MS),
			})
			.onConflictDoNothing({ target: setupRuns.code })
			.returning();
		const row = inserted[0];
		if (row) {
			return toView(row);
		}
	}
	throw new Error("Tripwire could not start a setup run. Try again.");
}

function runCodeOf(raw: string): string | null {
	const pair = parseSetupCommandArg(raw);
	const code = pair ? pair.code : raw.trim();
	return setupRunCodeSchema.safeParse(code).success ? code : null;
}

export type SetupProgressResult =
	| { recorded: true; continueUpdates: boolean }
	| { recorded: false; continueUpdates: false };

export async function reportSetupProgress(
	db: Db,
	input: {
		userId: string;
		orgIds: readonly string[];
		progress: SetupProgressInput;
		now?: Date;
	},
): Promise<SetupProgressResult> {
	const code = runCodeOf(input.progress.runCode);
	if (!code) {
		return { recorded: false, continueUpdates: false };
	}
	const now = input.now ?? new Date();
	const rows = await db
		.select()
		.from(setupRuns)
		.where(eq(setupRuns.code, code))
		.limit(1);
	const row = rows[0];
	if (
		!row ||
		row.userId !== input.userId ||
		!input.orgIds.includes(row.orgId) ||
		row.expiresAt <= now ||
		row.completedAt
	) {
		return { recorded: false, continueUpdates: false };
	}
	const current = setupStagesSchema.safeParse(row.stages);
	const stages: SetupStages = current.success ? { ...current.data } : {};
	const stamp = now.toISOString();
	const index = SETUP_STAGES.indexOf(input.progress.stage);
	for (const earlier of SETUP_STAGES.slice(0, index)) {
		if (!stages[earlier]) {
			stages[earlier] = { status: "skipped", detail: null, updatedAt: stamp };
		}
	}
	stages[input.progress.stage] = {
		status: input.progress.status,
		detail: input.progress.detail || null,
		updatedAt: stamp,
	};
	const finished =
		input.progress.stage === "verify_check" &&
		(input.progress.status === "completed" ||
			input.progress.status === "skipped");
	await db
		.update(setupRuns)
		.set({
			stages: setupStagesSchema.parse(stages),
			lastReportAt: now,
			completedAt: finished ? now : null,
		})
		.where(eq(setupRuns.id, row.id));
	await notifyLive(db, { type: "setup", runId: row.id });
	return { recorded: true, continueUpdates: !finished };
}

export type SetupNextStep =
	| "install_app"
	| "sync_repos"
	| "turn_on_gate"
	| "done";

export interface SetupStatus {
	hasInstallation: boolean;
	repos: SwitcherRepo[];
	nextStep: SetupNextStep;
}

export async function getSetupStatus(
	db: Db,
	orgId: string,
): Promise<SetupStatus> {
	const [state, repos] = await Promise.all([
		getOrgInstallState(db, orgId),
		listOrgSwitcherRepos(db, orgId),
	]);
	const nextStep: SetupNextStep = !state.hasInstallation
		? "install_app"
		: repos.length === 0
			? "sync_repos"
			: repos.some((repo) => repo.armed)
				? "done"
				: "turn_on_gate";
	return { hasInstallation: state.hasInstallation, repos, nextStep };
}

export const AGENT_SETUP_REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export interface AgentSetupPromptState {
	visible: boolean;
	reminder: boolean;
	dismissCount: number;
}

export async function hasTriedAgentSetup(
	db: Db,
	input: { orgId: string; userId: string },
): Promise<boolean> {
	const [grants, runs] = await Promise.all([
		db
			.select({ id: agentGrants.id })
			.from(agentGrants)
			.where(
				and(
					eq(agentGrants.userId, input.userId),
					sql`${input.orgId} = ANY(${agentGrants.orgIds})`,
				),
			)
			.limit(1),
		db
			.select({ id: setupRuns.id })
			.from(setupRuns)
			.where(
				and(
					eq(setupRuns.orgId, input.orgId),
					isNotNull(setupRuns.lastReportAt),
				),
			)
			.limit(1),
	]);
	return grants.length > 0 || runs.length > 0;
}

export async function getAgentSetupPrompt(
	db: Db,
	input: { orgId: string; userId: string; now?: Date },
): Promise<AgentSetupPromptState> {
	const now = input.now ?? new Date();
	const [tried, rows] = await Promise.all([
		hasTriedAgentSetup(db, input),
		db
			.select()
			.from(agentSetupPrompts)
			.where(
				and(
					eq(agentSetupPrompts.userId, input.userId),
					eq(agentSetupPrompts.orgId, input.orgId),
				),
			)
			.limit(1),
	]);
	const row = rows[0];
	const dismissCount = row?.dismissCount ?? 0;
	if (tried) {
		return { visible: false, reminder: false, dismissCount };
	}
	if (dismissCount === 0) {
		return { visible: true, reminder: false, dismissCount };
	}
	const reminderDue =
		dismissCount === 1 &&
		row?.firstDismissedAt != null &&
		now.getTime() - row.firstDismissedAt.getTime() >=
			AGENT_SETUP_REMIND_AFTER_MS;
	return { visible: reminderDue, reminder: reminderDue, dismissCount };
}

export async function dismissAgentSetupPrompt(
	db: Db,
	input: { orgId: string; userId: string; now?: Date },
): Promise<{ dismissCount: number }> {
	const now = input.now ?? new Date();
	const remindBefore = new Date(now.getTime() - AGENT_SETUP_REMIND_AFTER_MS);
	await db
		.insert(agentSetupPrompts)
		.values({
			userId: input.userId,
			orgId: input.orgId,
			firstDismissedAt: now,
			dismissCount: 1,
		})
		.onConflictDoUpdate({
			target: [agentSetupPrompts.userId, agentSetupPrompts.orgId],
			set: { dismissCount: 2 },
			setWhere: and(
				eq(agentSetupPrompts.dismissCount, 1),
				lte(agentSetupPrompts.firstDismissedAt, remindBefore),
			),
		});
	const rows = await db
		.select({ dismissCount: agentSetupPrompts.dismissCount })
		.from(agentSetupPrompts)
		.where(
			and(
				eq(agentSetupPrompts.userId, input.userId),
				eq(agentSetupPrompts.orgId, input.orgId),
			),
		)
		.limit(1);
	return { dismissCount: rows[0]?.dismissCount ?? 1 };
}
