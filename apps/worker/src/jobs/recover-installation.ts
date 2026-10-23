import type { InstallAccessResult } from "@tripwire/contracts";
import type { Db, RecoverInstallationJob } from "@tripwire/db";
import { accountServices, installationAccessServices } from "@tripwire/db";
import type {
	GithubInstallation,
	GithubInstallationRepo,
	UserInstallationAccess,
	UserInstallationRepo,
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
	userInstallationRepositories(
		userToken: string,
		installationId: string,
	): Promise<UserInstallationAccess>;
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

interface UserCredentials {
	accountId: string;
	token: string | null;
}

async function userCredentials(
	db: Db,
	userId: string,
	now: Date,
): Promise<UserCredentials | null> {
	const account = await accountServices.getForgeAccount(db, userId, "github");
	if (!account) {
		return null;
	}
	const expiresAt = account.accessTokenExpiresAt;
	const expired = expiresAt !== null && expiresAt.getTime() <= now.getTime();
	return {
		accountId: account.accountId,
		token: account.accessToken && !expired ? account.accessToken : null,
	};
}

const GRANTED: Outcome = { result: "granted-admin", failure: null };
const DENIED: Outcome = { result: "denied", failure: null };
const NOT_ADMIN: Outcome = { result: "not-admin", failure: "not-admin" };
const TOKEN_EXPIRED: Outcome = {
	result: "token-expired",
	failure: "token-expired",
};

function adminOfEvery(
	installed: GithubInstallationRepo[],
	visible: UserInstallationRepo[],
): boolean {
	const admin = new Set(
		visible.filter((repo) => repo.admin).map((repo) => repo.externalId),
	);
	return installed.every((repo) => admin.has(repo.externalId));
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
	const user = await userCredentials(
		deps.db,
		job.userId,
		deps.now?.() ?? new Date(),
	);
	if (!user) {
		return TOKEN_EXPIRED;
	}
	if (
		installation.accountId !== null &&
		installation.accountId === user.accountId
	) {
		return GRANTED;
	}
	if (installation.accountType !== "Organization") {
		return DENIED;
	}
	if (!user.token) {
		return TOKEN_EXPIRED;
	}
	if (repositories.length === 0) {
		return DENIED;
	}
	const access = await github.userInstallationRepositories(
		user.token,
		job.installationId,
	);
	if (access.status === "unauthorized") {
		return TOKEN_EXPIRED;
	}
	if (access.status === "forbidden") {
		return {
			result: "failed",
			failure: "unverifiable",
			error: "GET /user/installations/{id}/repositories refused the user token",
		};
	}
	if (access.status === "not-found") {
		return NOT_ADMIN;
	}
	return adminOfEvery(repositories, access.repositories) ? GRANTED : NOT_ADMIN;
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
