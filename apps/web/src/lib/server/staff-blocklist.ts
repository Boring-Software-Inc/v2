import {
	blocklistDispatchResponseSchema,
	SHARED_BLOCKLIST_REPOSITORY,
	type staffBlocklistAdditionSchema,
} from "@tripwire/contracts";
import { sharedBlocklistTarget } from "@tripwire/utils/shared-blocklist";
import pino from "pino";
import type { z } from "zod";

import { lookupGitHubAccount } from "#/lib/server/github-account";

const logger = pino({ name: "staff-blocklist" });
const repoPath = new URL(SHARED_BLOCKLIST_REPOSITORY).pathname;

export async function queueSharedBlocklistAddition(
	input: z.infer<typeof staffBlocklistAdditionSchema>,
	actorId: string,
	token = process.env.TRIPWIRE_SHARED_BLOCKLIST_ACTIONS_TOKEN,
	request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
	if (!token) return { status: "unavailable" } as const;
	if (input.expiresAt !== null && Date.parse(input.expiresAt) <= Date.now()) {
		return { status: "invalid-expiry" } as const;
	}
	try {
		const headers = {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2026-03-10",
		};
		const account = await lookupGitHubAccount(input.login, headers, request);
		if (!account) return { status: "missing-account" } as const;
		const response = await request(
			`https://api.github.com/repos${repoPath}/actions/workflows/publish-snapshot.yml/dispatches`,
			{
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({
					ref: "main",
					inputs: {
						...input,
						target: sharedBlocklistTarget(),
						expiresAt: input.expiresAt ?? "",
						login: account.login,
						accountId: String(account.id),
						operation: "add",
					},
				}),
				redirect: "error",
				signal: AbortSignal.timeout(5_000),
			},
		);
		if (!response.ok)
			throw new Error(`GitHub dispatch returned ${response.status}`);
		const run =
			response.status === 204
				? null
				: blocklistDispatchResponseSchema.safeParse(await response.json());
		const runId = run?.success ? run.data.workflow_run_id : null;
		logger.info(
			{ actorId, accountId: account.id, runId },
			"Queued blocklist addition",
		);
		return {
			status: "queued",
			url: runId
				? `${SHARED_BLOCKLIST_REPOSITORY}/actions/runs/${runId}`
				: `${SHARED_BLOCKLIST_REPOSITORY}/actions/workflows/publish-snapshot.yml`,
		} as const;
	} catch (error) {
		logger.warn({ err: error, actorId }, "Could not queue blocklist addition");
		return { status: "failed" } as const;
	}
}
