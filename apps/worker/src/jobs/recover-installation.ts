import type { InstallAccessResult } from "@tripwire/contracts";
import type { Db, RecoverInstallationJob } from "@tripwire/db";
import { accountServices, installationAccessServices } from "@tripwire/db";
import type {
	GithubInstallation,
	GithubInstallationRepo,
	UserInstallationAccess,
} from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import type {
	InstallFailureState,
	ReportInstallFailure,
} from "../report-install-failure.ts";
import { upsertInstallation } from "./installation-sync.ts";

export interface InstallationLookup {
	getInstallation(installationId: string): Promise<GithubInstallation | null>;
	listRepositories(installationId: string): Promise<GithubInstallationRepo[]>;
	userInstallations(userToken: string): Promise<UserInstallationAccess>;
}

export interface RecoverInstallationDeps {
	db: Db;
	github: InstallationLookup | null;
	logger: Logger;
	report: ReportInstallFailure;
	now?: () => Date;
}

interface Outcome {
	result: InstallAccessResult;
	failure: InstallFailureState | null;
	error?: string;
}

async function userToken(
	db: Db,
	userId: string,
	now: Date,
): Promise<string | null> {
	const account = await accountServices.getForgeAccount(db, userId, "github");
	if (!account?.accessToken) {
		return null;
	}
	const expiresAt = account.accessTokenExpiresAt;
	if (expiresAt && expiresAt.getTime() <= now.getTime()) {
		return null;
	}
	return account.accessToken;
}

async function verify(
	deps: RecoverInstallationDeps,
	github: InstallationLookup,
	job: RecoverInstallationJob,
): Promise<Outcome> {
	const installation = await github.getInstallation(job.installationId);
	if (!installation) {
		return { result: "not-for-tripwire", failure: "not-for-tripwire" };
	}
	const repositories = await github.listRepositories(job.installationId);
	await upsertInstallation(
		deps.db,
		{
			installationId: job.installationId,
			account: installation.account,
			accountType: installation.accountType,
			repositories,
		},
		deps.logger,
	);
	const token = await userToken(
		deps.db,
		job.userId,
		deps.now?.() ?? new Date(),
	);
	if (!token) {
		return { result: "token-expired", failure: "token-expired" };
	}
	const access = await github.userInstallations(token);
	if (access.status === "unauthorized") {
		return { result: "token-expired", failure: "token-expired" };
	}
	if (access.status === "forbidden") {
		return {
			result: "failed",
			failure: "unverifiable",
			error: "GET /user/installations refused the user token",
		};
	}
	return access.installationIds.includes(job.installationId)
		? { result: "granted", failure: null }
		: { result: "denied", failure: null };
}

async function outcomeFor(
	deps: RecoverInstallationDeps,
	job: RecoverInstallationJob,
): Promise<Outcome> {
	if (!deps.github) {
		return {
			result: "failed",
			failure: "recovery-failed",
			error: "github app credentials missing",
		};
	}
	try {
		return await verify(deps, deps.github, job);
	} catch (error) {
		return {
			result: "failed",
			failure: "recovery-failed",
			error: getErrorMessage(error),
		};
	}
}

export async function recoverInstallation(
	deps: RecoverInstallationDeps,
	job: RecoverInstallationJob,
): Promise<InstallAccessResult> {
	const outcome = await outcomeFor(deps, job);
	await installationAccessServices.recordInstallAccessCheck(deps.db, {
		userId: job.userId,
		forge: "github",
		installationId: job.installationId,
		result: outcome.result,
		at: deps.now?.(),
	});
	if (outcome.failure) {
		deps.report({
			state: outcome.failure,
			installationId: job.installationId,
			userId: job.userId,
			error: outcome.error,
		});
	}
	deps.logger.info(
		{ installationId: job.installationId, result: outcome.result },
		"installation recovery finished",
	);
	return outcome.result;
}
