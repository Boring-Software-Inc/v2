import { accountServices, repoServices } from "@tripwire/db";
import {
	createProjectHook,
	listMaintainedProjects,
	refreshGitlabToken,
} from "@tripwire/forge-gitlab";
import { getErrorMessage } from "@tripwire/utils";
import { Hono } from "hono";
import type { ApiEnv } from "../env.ts";

/**
 * POST /gitlab/import — the GitLab analog of GitHub's install→webhook-sync. The
 * maintainer connected GitLab at login (OAuth, `api` scope); this reads that
 * token, registers a webhook on every project they maintain, and upserts each
 * as an UNCLAIMED repo (`orgId: null`, `installationId` = their GitLab account
 * id). The shared claim screen then binds them to the org they pick — same flow
 * as GitHub.
 */
export const gitlabImport = new Hono<ApiEnv>().post("/import", async (c) => {
	const { auth, db, logger } = c.get("deps");
	if (!auth) {
		return c.json({ error: "auth disabled" }, 503);
	}
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) {
		return c.json({ error: "session required" }, 401);
	}

	const forgeAccount = await accountServices.getForgeAccount(
		db,
		session.user.id,
		"gitlab",
	);
	if (!forgeAccount) {
		return c.json({ error: "connect gitlab first" }, 400);
	}

	const gitlabOAuth =
		process.env.GITLAB_OAUTH_CLIENT_ID && process.env.GITLAB_OAUTH_CLIENT_SECRET
			? {
					clientId: process.env.GITLAB_OAUTH_CLIENT_ID,
					clientSecret: process.env.GITLAB_OAUTH_CLIENT_SECRET,
					...(process.env.GITLAB_OAUTH_ISSUER
						? { baseUrl: process.env.GITLAB_OAUTH_ISSUER }
						: {}),
				}
			: null;

	// NOT `forgeAccount.accessToken` — GitLab access tokens expire in 2h and the
	// stored one is whatever login minted. `getFreshForgeToken` is the SAME path
	// the worker uses (compare-and-swap on the refresh token), so the two
	// processes cannot clobber each other's refresh. Deliberately not
	// better-auth's `getAccessToken`: that would be a second, unsynchronized
	// writer of the same row.
	const token = await accountServices
		.getFreshForgeToken(db, "gitlab", forgeAccount.accountId, async (rt) => {
			if (!gitlabOAuth) {
				throw new Error("gitlab oauth credentials absent");
			}
			return await refreshGitlabToken(gitlabOAuth, rt);
		})
		.catch((error: unknown) => {
			logger.warn(
				{ userId: session.user.id, error: getErrorMessage(error) },
				"gitlab token refresh failed — re-authorization required",
			);
			return null;
		});
	if (!token) {
		return c.json({ error: "gitlab session expired — reconnect gitlab" }, 401);
	}

	const publicUrl =
		process.env.WEBHOOK_PUBLIC_URL ?? process.env.BETTER_AUTH_URL;
	if (!publicUrl) {
		return c.json({ error: "WEBHOOK_PUBLIC_URL is not set" }, 503);
	}
	const webhookUrl = `${publicUrl.replace(/\/$/, "")}/webhooks/gitlab`;
	const secret = process.env.GITLAB_WEBHOOK_SECRET ?? "";

	const options = { token };
	const projects = await listMaintainedProjects(options);
	let imported = 0;
	let hooksFailed = 0;
	for (const project of projects) {
		// Hook registration is best-effort: GitLab rejects an unreachable URL
		// (e.g. localhost with no tunnel), but the repo should still import so it
		// shows up for claiming. Re-import re-attempts the hook.
		// TODO(hook-idempotency): skip if a tripwire hook already exists (post-PoC).
		try {
			await createProjectHook(options, {
				projectId: project.externalId,
				url: webhookUrl,
				secret,
			});
		} catch (error) {
			hooksFailed += 1;
			logger.warn(
				{ project: project.fullName, error: getErrorMessage(error) },
				"gitlab hook registration failed — repo imported without delivery",
			);
		}
		await repoServices.ensureRepo(db, {
			forge: "gitlab",
			externalId: project.externalId,
			owner: project.owner,
			name: project.name,
			fullName: project.fullName,
			private: project.private,
			installationId: forgeAccount.accountId,
			orgId: null,
		});
		imported += 1;
	}
	// Re-importing an account whose projects are already bound to an org imports
	// nothing new. The caller needs to know that, or it sends the user to a claim
	// screen with nothing to claim.
	const unclaimed = await repoServices.countUnclaimedRepos(
		db,
		"gitlab",
		forgeAccount.accountId,
	);
	logger.info(
		{ userId: session.user.id, imported, hooksFailed, unclaimed },
		"gitlab projects imported",
	);
	return c.json({ imported, hooksFailed, unclaimed }, 200);
});
