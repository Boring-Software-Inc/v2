import { setResponseHeader } from "@tanstack/react-start/server";
import { getStartContext } from "@tanstack/start-storage-context";
import {
	GITCAFE_ISSUER,
	gitCafeAuthorizationResponseSchema,
	gitCafeConnectionJobSchema,
	gitCafeConnectPrincipalSchema,
	gitCafeConnectUserInfoSchema,
} from "@tripwire/contracts";
import { gitCafeConnectionServices } from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import pino from "pino";
import { getAuth } from "#/lib/server/auth";
import { getDb, getGitCafeConnectionBoss } from "#/lib/server/db";
import { readProviderAvailability } from "#/lib/server/provider-availability";

const logger = pino({ name: "gitcafe-connection" });

function privateResponse() {
	setResponseHeader("cache-control", "no-store");
	setResponseHeader("referrer-policy", "no-referrer");
}

export async function startGitCafeGrant(orgId: string, installationId: string) {
	privateResponse();
	const auth = getAuth();
	if (
		!auth ||
		!(await readProviderAvailability()).available.includes("gitcafe")
	)
		throw new Error("GitCafe isn't configured on this Tripwire server.");
	const response = await auth.api.gitCafeConnectStart({
		headers: getStartContext().request.headers,
		body: { orgId, intendedInstallationId: installationId },
		asResponse: true,
	});
	if (!response.ok)
		throw new Error(
			"GitCafe authorization was refused. Check your session and org permissions, then try again.",
		);
	setResponseHeader("set-cookie", response.headers.getSetCookie());
	return gitCafeAuthorizationResponseSchema.parse(await response.json());
}

/** Only the opaque handle crosses the browser; the delegated token dies in this request. */
export async function confirmGitCafeGrant(
	orgId: string,
	installationId: string,
	proofHandle: string,
) {
	privateResponse();
	const auth = getAuth();
	if (
		!auth ||
		!(await readProviderAvailability()).available.includes("gitcafe")
	)
		return { ok: false as const, reason: "unavailable" };
	const headers = getStartContext().request.headers;
	if (headers.get("origin") !== new URL((await auth.$context).baseURL).origin)
		return { ok: false as const, reason: "refused" };
	const requestId = generateId();
	try {
		const proof = await auth.api.consumeGitCafeConnectProof({
			headers,
			body: { orgId, intendedInstallationId: installationId, proofHandle },
		});
		const read = async (path: string): Promise<unknown> => {
			const response = await fetch(`${GITCAFE_ISSUER}${path}`, {
				headers: {
					authorization: `Bearer ${proof.accessToken}`,
					accept: "application/json",
				},
				redirect: "error",
				cache: "no-store",
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) throw new Error("GitCafe authority unavailable");
			return response.json();
		};
		const person = gitCafeConnectUserInfoSchema.parse(
			await read("/api/oauth/userinfo"),
		);
		const principal = gitCafeConnectPrincipalSchema.parse(
			await read("/api/auth/principal"),
		);
		const current = await auth.api.getSession({
			headers,
			query: { disableCookieCache: true },
		});
		const now = Date.now();
		if (
			person.sub !== proof.subject ||
			principal.actorId !== proof.actorId ||
			!current ||
			current.user.id !== proof.userId ||
			current.session.id !== proof.sessionId ||
			proof.expiresAt <= now ||
			proof.tokenExpiresAt <= now
		)
			return { ok: false as const, reason: "refused" };
		const job = gitCafeConnectionJobSchema.parse({
			userId: proof.userId,
			sessionId: proof.sessionId,
			orgId,
			installationId,
			subject: proof.subject,
			actorId: proof.actorId,
			authorizedAt: now,
			expiresAt: Math.min(
				proof.expiresAt,
				proof.tokenExpiresAt,
				now + 2 * 60_000,
			),
			requestId,
		});
		const result = await gitCafeConnectionServices.enqueueGitCafeConnection(
			getDb().db,
			await getGitCafeConnectionBoss(requestId).catch(() => null),
			job,
		);
		if (!result.ok && result.reason === "queue-unavailable")
			logger.error(
				{ requestId, error: "queue-unavailable" },
				"GitCafe connection queue unavailable",
			);
		return result;
	} catch {
		logger.warn(
			{ requestId, error: "confirmation-failed" },
			"GitCafe connection confirmation failed",
		);
		return { ok: false as const, reason: "retry" };
	}
}

export async function readGitCafeConnectionStatus(
	orgId: string,
	installationId: string,
	jobId?: string,
) {
	privateResponse();
	const auth = getAuth();
	const current = await auth?.api.getSession({
		headers: getStartContext().request.headers,
		query: { disableCookieCache: true },
	});
	if (!current) return { status: "retry" as const };
	const requestId = generateId();
	try {
		return await gitCafeConnectionServices.getGitCafeConnectionStatus(
			getDb().db,
			await getGitCafeConnectionBoss(requestId),
			{
				userId: current.user.id,
				sessionId: current.session.id,
				orgId,
				installationId,
				jobId,
			},
		);
	} catch {
		logger.warn(
			{ requestId, error: "status-failed" },
			"GitCafe connection status unavailable",
		);
		return { status: "retry" as const };
	}
}
