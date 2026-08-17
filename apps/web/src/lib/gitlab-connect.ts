import { ForgeReauthRequiredError } from "#/lib/forge-connect";

/**
 * Trigger the GitLab import on the api head — `start.ts` proxies
 * `POST /api/gitlab/import` same-origin with the session cookie. The api lists
 * the maintainer's projects, registers a webhook on each, and upserts them as
 * UNCLAIMED repos; the shared claim screen then binds them to a chosen org.
 * Throws with the api's message on failure so the caller can toast it (e.g.
 * "connect gitlab first").
 */
export interface GitlabImportResult {
	imported: number;
	/** Projects still waiting to be bound to an org. 0 ⇒ nothing to claim, so
	 * the claim screen would be an empty dead end. */
	unclaimed: number;
}

export async function importGitlabRepos(): Promise<GitlabImportResult> {
	const res = await fetch("/api/gitlab/import", { method: "POST" });
	const body = (await res.json().catch(() => null)) as {
		imported?: number;
		unclaimed?: number;
		error?: string;
	} | null;
	// 401 is the one failure with a recovery: the stored token is dead and the
	// refresh couldn't save it. Typed so the caller can offer reconnect instead
	// of a dead-end toast.
	if (res.status === 401) {
		throw new ForgeReauthRequiredError(
			"gitlab",
			body?.error ?? "gitlab session expired",
		);
	}
	if (!res.ok) {
		throw new Error(body?.error ?? "gitlab import failed");
	}
	return { imported: body?.imported ?? 0, unclaimed: body?.unclaimed ?? 0 };
}
