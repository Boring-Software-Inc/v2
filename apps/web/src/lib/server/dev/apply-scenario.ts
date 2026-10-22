import type { Auth } from "@tripwire/auth/server";
import {
	accessServices,
	type Db,
	ensureDemoRepo,
	ensureDemoTeammates,
	ensureTeamOrg,
	orgServices,
	resetDemoData,
	schema,
	seedActivePersonaExtras,
	seedApprovedInstallRequest,
	seedDemoWorkflows,
	seedEconomics,
	seedPublicRun,
	seedRepoExtras,
	seedStory,
	seedUnclaimedInstall,
} from "@tripwire/db";
import { eq } from "drizzle-orm";
import type { DevScenario } from "#/lib/dev/scenarios";
import { signInstallState } from "#/lib/server/install-state";
import {
	DEV_PASSWORD,
	type DevUserPlan,
	planScenario,
	type RepoPlan,
	resolveLanding,
	type ScenarioPlan,
} from "./scenario-plan.ts";

export interface AppliedScenario {
	landing: string;
	session: Response | null;
}

interface DevUser {
	id: string;
	session: Response;
}

interface TargetOrg {
	id: string;
	slug: string;
}

type SeededRepo = Awaited<ReturnType<typeof ensureDemoRepo>>;

async function signUp(db: Db, auth: Auth, user: DevUserPlan): Promise<DevUser> {
	const session = await auth.api.signUpEmail({
		body: { email: user.email, password: DEV_PASSWORD, name: user.name },
		asResponse: true,
	});
	if (!session.ok) {
		throw new Error(`could not sign up ${user.email} (${session.status})`);
	}
	const [row] = await db
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.email, user.email));
	if (!row) {
		throw new Error(`no user row for ${user.email} after sign up`);
	}
	await accessServices.promoteUserAccess(db, {
		userId: row.id,
		reviewedBy: row.id,
	});
	const approved = await auth.api.signInEmail({
		body: { email: user.email, password: DEV_PASSWORD },
		asResponse: true,
	});
	if (!approved.ok) {
		throw new Error(`could not sign in ${user.email} (${approved.status})`);
	}
	return { id: row.id, session: approved };
}

async function targetOrg(
	db: Db,
	plan: ScenarioPlan,
	user: DevUser | null,
	userName: string,
): Promise<TargetOrg | null> {
	if (!user) {
		return null;
	}
	if (plan.orgKind === "personal") {
		return await orgServices.ensurePersonalOrg(db, {
			userId: user.id,
			name: userName,
		});
	}
	const [admin, ...teammates] = await ensureDemoTeammates(db);
	if (!admin) {
		throw new Error("no demo teammate to own the team org");
	}
	return await ensureTeamOrg(db, {
		adminUserId: admin,
		memberUserIds: plan.teamRole ? [...teammates, user.id] : teammates,
	});
}

async function seedRepos(
	db: Db,
	input: {
		repos: RepoPlan;
		org: TargetOrg;
		plan: ScenarioPlan;
		userId: string;
		now: Date;
	},
): Promise<SeededRepo[]> {
	const { repos, org, now } = input;
	const seeded: SeededRepo[] = [];
	for (const name of repos.names) {
		const repo = await ensureDemoRepo(db, name, {
			installationId: repos.installationId,
		});
		if (repos.storyDays !== null) {
			await seedStory(db, repo, now, { days: repos.storyDays });
		}
		if (repos.kind !== "empty" && repos.kind !== "active") {
			await seedRepoExtras(db, repo.id);
		}
		seeded.push(repo);
	}
	if (input.plan.orgKind === "team") {
		await orgServices.linkOrgInstallation(db, {
			orgId: org.id,
			installationId: repos.installationId,
			accountType: "Organization",
			accountLogin: "tripwire-demo",
		});
	} else {
		await orgServices.linkOrgInstallation(db, {
			orgId: org.id,
			installationId: repos.installationId,
		});
	}
	const [repo] = seeded;
	if (repos.kind !== "active" || !repo) {
		return seeded;
	}
	if (input.plan.orgKind === "personal") {
		await seedActivePersonaExtras(db, {
			userId: input.userId,
			orgId: org.id,
			repo,
			now,
		});
		return seeded;
	}
	await seedRepoExtras(db, repo.id);
	await seedEconomics(db, {
		orgId: org.id,
		repoFullName: repo.fullName,
		now,
		days: 30,
	});
	return seeded;
}

export async function applyScenario(input: {
	db: Db;
	auth: Auth;
	scenario: DevScenario;
	now: Date;
}): Promise<AppliedScenario> {
	const { db, auth, scenario, now } = input;
	const plan = planScenario(scenario);
	await resetDemoData(db);

	const user = plan.user ? await signUp(db, auth, plan.user) : null;
	const org = await targetOrg(db, plan, user, plan.user?.name ?? "");
	const repos =
		plan.repos && org && user
			? await seedRepos(db, {
					repos: plan.repos,
					org,
					plan,
					userId: user.id,
					now,
				})
			: [];
	if (plan.unclaimed) {
		await seedUnclaimedInstall(db, { ...plan.unclaimed, now });
	}
	if (plan.approvedRequest && user) {
		await seedApprovedInstallRequest(db, { userId: user.id, now });
	}
	const workflowId = await seedDemoWorkflows(db, {
		repoIds: repos.map((repo) => repo.id),
		mode: plan.workflows,
	});
	const publicRunId = plan.publicRun
		? await seedPublicRun(
				db,
				await ensureDemoRepo(db, "public-oss", { private: false }),
				now,
			)
		: null;
	const installState =
		plan.unclaimed && user && org
			? signInstallState({ userId: user.id, orgId: org.id })
			: null;

	return {
		landing: resolveLanding(scenario, plan, {
			orgSlug: org?.slug ?? null,
			repoName: repos[0]?.name ?? null,
			workflowId,
			installState,
			publicRunId,
		}),
		session: user?.session ?? null,
	};
}
