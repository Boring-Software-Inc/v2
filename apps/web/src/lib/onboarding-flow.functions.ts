import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	draftOnboardingWorkflow,
	EMPTY_ONBOARDING_ANSWERS,
	type JsonValue,
	ONBOARDING_MAX_REPORTED,
	type OnboardingAnswersPatch,
	type OnboardingStep,
	type OnboardingView,
	onboardingAnswersPatchSchema,
	onboardingStepSchema,
	orgSlugSchema,
	RULE_CATALOG,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import type {
	Db,
	OnboardingRecord,
	OrgWithRole,
	RepoLite,
	StoredChangeRequest,
} from "@tripwire/db";
import { z } from "zod";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

/** What the onboarding page renders from: progress plus what it resolves to. */
export interface OnboardingState extends OnboardingView {
	/** Where a "For myself" user lands: the personal workspace every user has. */
	personalOrgSlug: string | null;
	/** Whether the chosen repo has change requests to report in `check`. */
	hasChangeRequests: boolean;
	/**
	 * The forge the connect step starts on: the chosen repo's, else GitCafe for
	 * someone who signed in with GitCafe alone.
	 */
	connectForge: "github" | "gitcafe";
}

async function sessionUserId(): Promise<string> {
	const { requireSession } = await import("#/lib/server/session");
	const userId = await requireSession();
	if (!userId) {
		throw new Error("Your session ended. Sign in again to continue.");
	}
	return userId;
}

async function database(): Promise<Db> {
	const { getDb } = await import("#/lib/server/db");
	return getDb().db;
}

async function toState(
	db: Db,
	userId: string,
	record: OnboardingRecord | null,
): Promise<OnboardingState> {
	const { accountServices, orgServices, repoServices, userOnboardingServices } =
		await import("@tripwire/db");
	const [orgs, github, gitcafe] = await Promise.all([
		orgServices.listUserOrgs(db, userId),
		accountServices.getForgeAccount(db, userId, "github"),
		accountServices.getForgeAccount(db, userId, "gitcafe"),
	]);
	const org = orgs.find((entry) => entry.id === record?.orgId) ?? null;
	const repoRow =
		org && record?.repoId
			? await repoServices.getRepoById(db, record.repoId)
			: null;
	const repo =
		repoRow && repoRow.orgId === org?.id && repoRow.removedAt === null
			? repoRow
			: null;
	const hasChangeRequests = repo
		? (
				await userOnboardingServices.listStoredChangeRequests(
					db,
					{ fullName: repo.fullName, forge: repo.forge },
					{ limit: 1 },
				)
			).length > 0
		: false;
	return {
		status: record?.status ?? "in_progress",
		step: record?.step ?? "welcome",
		answers: record?.answers ?? EMPTY_ONBOARDING_ANSWERS,
		orgSlug: org?.slug ?? null,
		repo: repo
			? {
					id: repo.id,
					forge: repo.forge,
					fullName: repo.fullName,
					name: repo.name,
					armed: repo.armed,
				}
			: null,
		personalOrgSlug: orgs.find((entry) => entry.isPersonal)?.slug ?? null,
		hasChangeRequests,
		connectForge:
			repo?.forge === "github" || repo?.forge === "gitcafe"
				? repo.forge
				: gitcafe && !github
					? "gitcafe"
					: "github",
	};
}

export const getOnboarding = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<OnboardingState> => {
		const userId = await sessionUserId();
		const db = await database();
		const { userOnboardingServices } = await import("@tripwire/db");
		return toState(
			db,
			userId,
			await userOnboardingServices.getOnboarding(db, userId),
		);
	});

const saveInputSchema = z.object({
	step: onboardingStepSchema.optional(),
	answers: onboardingAnswersPatchSchema.optional(),
	/** The workspace being onboarded, by slug; the caller must be a member. */
	org: z.string().min(1).max(64).nullable().optional(),
	/** A repo in that workspace; null clears it. */
	repoId: z.string().min(1).max(64).nullable().optional(),
});

export interface SaveOnboardingInput {
	step?: OnboardingStep;
	answers?: OnboardingAnswersPatch;
	org?: string | null;
	repoId?: string | null;
}

/**
 * Records a step's answers and the step reached. Returns `finished` when a
 * stale tab tries to write after onboarding was completed or skipped.
 */
export const saveOnboardingStep = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: SaveOnboardingInput) => saveInputSchema.parse(input))
	.handler(
		async ({
			data,
		}): Promise<
			{ status: "saved"; state: OnboardingState } | { status: "finished" }
		> => {
			const userId = await sessionUserId();
			const db = await database();
			const { orgServices, repoServices, userOnboardingServices } =
				await import("@tripwire/db");
			let orgId: string | null | undefined;
			if (data.org === null) {
				orgId = null;
			} else if (data.org !== undefined) {
				const org = await orgServices.getOrgForUser(db, {
					slug: data.org,
					userId,
				});
				if (!org) {
					throw notFound();
				}
				orgId = org.id;
			}
			if (data.repoId) {
				const current = await userOnboardingServices.getOnboarding(db, userId);
				const scope = orgId ?? current?.orgId ?? null;
				const repo = await repoServices.getRepoById(db, data.repoId);
				if (!(scope && repo && repo.orgId === scope)) {
					throw notFound();
				}
			}
			const record = await userOnboardingServices.saveOnboardingProgress(db, {
				userId,
				step: data.step,
				answers: data.answers,
				orgId,
				repoId: data.repoId,
			});
			if (!record) {
				return { status: "finished" };
			}
			return { status: "saved", state: await toState(db, userId, record) };
		},
	);

/**
 * Completing or skipping clears the requirement, then sends the user to the
 * repo they set up, or to their workspace home.
 */
export const finishOnboarding = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { outcome: "completed" | "skipped" }) => ({
		outcome: z.enum(["completed", "skipped"]).parse(input.outcome),
	}))
	.handler(async ({ data }): Promise<{ to: string }> => {
		const userId = await sessionUserId();
		const db = await database();
		const { userOnboardingServices } = await import("@tripwire/db");
		const state = await toState(
			db,
			userId,
			await userOnboardingServices.getOnboarding(db, userId),
		);
		await userOnboardingServices.finishOnboarding(db, {
			userId,
			outcome: data.outcome,
		});
		const org = state.orgSlug ?? state.personalOrgSlug;
		if (org && state.repo) {
			return { to: `/${org}/${state.repo.name}/moderation` };
		}
		return { to: org ? `/${org}/home` : "/" };
	});

export type SlugCheck = "available" | "taken" | "invalid";

export const checkOrgSlug = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { slug: string }) => ({
		slug: z.string().max(64).parse(input.slug),
	}))
	.handler(async ({ data }): Promise<{ status: SlugCheck }> => {
		if (!orgSlugSchema.safeParse(data.slug).success) {
			return { status: "invalid" };
		}
		const db = await database();
		const { userOnboardingServices } = await import("@tripwire/db");
		return {
			status: (await userOnboardingServices.isOrgSlugTaken(db, data.slug))
				? "taken"
				: "available",
		};
	});

async function orgRepo(orgId: string, repoId: string) {
	await requireOrgRepoById(orgId, repoId);
	const { repoServices } = await import("@tripwire/db");
	const repo = await repoServices.getRepoById(await database(), repoId);
	if (!repo) {
		throw notFound();
	}
	return repo;
}

export const listOnboardingChangeRequests = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("activity:read")])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			query?: string;
			numbers?: number[];
		}) => ({
			org: z.string().parse(input.org),
			repoId: z.string().parse(input.repoId),
			query: z.string().max(200).optional().parse(input.query),
			numbers: z
				.array(z.number().int().positive())
				.max(ONBOARDING_MAX_REPORTED)
				.optional()
				.parse(input.numbers),
		}),
	)
	.handler(async ({ data, context }): Promise<StoredChangeRequest[]> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await orgRepo(org.id, data.repoId);
		const { userOnboardingServices } = await import("@tripwire/db");
		return userOnboardingServices.listStoredChangeRequests(
			await database(),
			{ fullName: repo.fullName, forge: repo.forge },
			{ query: data.query, numbers: data.numbers, limit: 8 },
		);
	});

const reportedSchema = z
	.array(z.number().int().positive())
	.min(1)
	.max(ONBOARDING_MAX_REPORTED);

/**
 * The drafted workflow for the reported change requests, built the same way
 * for the preview and the save so the user saves exactly what they saw.
 */
async function draftFor(
	repo: { id: string; fullName: string; forge: string },
	numbers: readonly number[],
): Promise<WorkflowDefinition | null> {
	const db = await database();
	const { repoServices, userOnboardingServices } = await import("@tripwire/db");
	const [failed, configs] = await Promise.all([
		userOnboardingServices.failedRulesForChangeRequests(
			db,
			{ fullName: repo.fullName, forge: repo.forge },
			numbers,
		),
		repoServices.listRuleConfigs(db, repo.id),
	]);
	return draftOnboardingWorkflow({
		id: `onboarding-${repo.id}`,
		name: "",
		failed: failed.map((ruleId) => ({
			ruleId,
			config: (configs.find((row) => row.ruleId === ruleId)?.config ??
				RULE_CATALOG.find((entry) => entry.ruleId === ruleId)?.defaultConfig ??
				{}) as JsonValue,
		})),
	});
}

export const previewOnboardingWorkflow = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:read"),
	])
	.inputValidator(
		(input: { org: string; repoId: string; numbers: number[] }) => ({
			org: z.string().parse(input.org),
			repoId: z.string().parse(input.repoId),
			numbers: reportedSchema.parse(input.numbers),
		}),
	)
	.handler(async ({ data, context }): Promise<OnboardingWorkflowDraft> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await orgRepo(org.id, data.repoId);
		const { userOnboardingServices } = await import("@tripwire/db");
		const [definition, builtFrom] = await Promise.all([
			draftFor(repo, data.numbers),
			userOnboardingServices.listStoredChangeRequests(
				await database(),
				{ fullName: repo.fullName, forge: repo.forge },
				{ numbers: data.numbers, limit: data.numbers.length },
			),
		]);
		return { definition, builtFrom };
	});

/** The drafted workflow and the reported change requests it was built from. */
export interface OnboardingWorkflowDraft {
	definition: WorkflowDefinition | null;
	builtFrom: StoredChangeRequest[];
}

export type SaveOnboardingWorkflowResult =
	| { status: "saved"; workflowId: string }
	| { status: "nothing-failed" }
	| { status: "not-enabled"; workflowId: string };

/** Saves the drafted workflow and turns it on. */
export const saveOnboardingWorkflow = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:manage"),
	])
	.inputValidator(
		(input: { org: string; repoId: string; numbers: number[] }) => ({
			org: z.string().parse(input.org),
			repoId: z.string().parse(input.repoId),
			numbers: reportedSchema.parse(input.numbers),
		}),
	)
	.handler(async ({ data, context }): Promise<SaveOnboardingWorkflowResult> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await orgRepo(org.id, data.repoId);
		const definition = await draftFor(repo, data.numbers);
		if (!definition) {
			return { status: "nothing-failed" };
		}
		const db = await database();
		const { workflowServices } = await import("@tripwire/db");
		const workflow = await workflowServices.createWorkflow(db, {
			repoId: repo.id,
			definition,
		});
		const enabled = await workflowServices.setWorkflowEnabled(db, {
			organizationId: org.id,
			repoId: repo.id,
			workflowId: workflow.id,
			enabled: true,
		});
		return enabled.ok
			? { status: "saved", workflowId: workflow.id }
			: { status: "not-enabled", workflowId: workflow.id };
	});

/** The workspace's connected repos for the repo picker, with private flags. */
export const listOnboardingRepos = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input: { org: string }) => ({
		org: z.string().parse(input.org),
	}))
	.handler(async ({ context }): Promise<RepoLite[]> => {
		const org = (context as { org: OrgWithRole }).org;
		const { orgServices } = await import("@tripwire/db");
		return orgServices.listOrgRepos(await database(), org.id);
	});
