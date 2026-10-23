import { createServerFn } from "@tanstack/react-start";
import type { ConnectedAgent, OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";

export type { ConnectedAgent };

export interface AgentRequestOrg {
	id: string;
	slug: string;
	name: string;
	isPersonal: boolean;
	avatarHue: number | null;
}

export type AgentRequest =
	| {
			status: "ready";
			clientId: string;
			clientName: string;
			redirectHost: string | null;
			scopes: string[];
			orgs: AgentRequestOrg[];
	  }
	| { status: "invalid" };

async function sessionContext() {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const headers = getStartContext().request.headers;
	const session = auth ? await auth.api.getSession({ headers }) : null;
	if (!(auth && session)) {
		throw new Error("Your session ended. Sign in again to continue.");
	}
	return { auth, headers, userId: session.user.id };
}

async function memberOrgs(userId: string): Promise<AgentRequestOrg[]> {
	const { getDb } = await import("#/lib/server/db");
	const { orgServices } = await import("@tripwire/db");
	const orgs = await orgServices.listUserOrgs(getDb().db, userId);
	return orgs.map((org: OrgWithRole) => ({
		id: org.id,
		slug: org.slug,
		name: org.name,
		isPersonal: org.isPersonal,
		avatarHue: org.avatarHue ?? null,
	}));
}

async function clientName(
	auth: NonNullable<ReturnType<typeof import("#/lib/server/auth").getAuth>>,
	headers: Headers,
	clientId: string,
): Promise<string | null> {
	try {
		const client = (await auth.api.getOAuthClientPublic({
			query: { client_id: clientId },
			headers,
		})) as { client_name?: string } | null;
		return client?.client_name ?? clientId;
	} catch {
		return null;
	}
}

function redirectHostOf(params: URLSearchParams): string | null {
	const uri = params.get("redirect_uri");
	if (!uri) {
		return null;
	}
	try {
		const url = new URL(uri);
		return url.host || `${url.protocol}//`;
	} catch {
		return null;
	}
}

async function grantOrgs(userId: string, clientId: string, orgIds: string[]) {
	const allowed = new Set((await memberOrgs(userId)).map((org) => org.id));
	const chosen = [...new Set(orgIds)].filter((id) => allowed.has(id));
	if (chosen.length === 0) {
		throw new Error("Pick at least one org for this agent.");
	}
	const { getDb } = await import("#/lib/server/db");
	const { agentServices } = await import("@tripwire/db");
	await agentServices.saveAgentGrant(getDb().db, {
		userId,
		clientId,
		orgIds: chosen,
	});
}

export const getConsentRequest = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { oauthQuery: string }) => input)
	.handler(async ({ data }): Promise<AgentRequest> => {
		const { auth, headers, userId } = await sessionContext();
		const { verifySignedOAuthQuery } = await import(
			"@tripwire/auth/agent-auth"
		);
		const { secret } = await auth.$context;
		if (!(await verifySignedOAuthQuery(data.oauthQuery, secret))) {
			return { status: "invalid" };
		}
		const params = new URLSearchParams(data.oauthQuery);
		const clientId = params.get("client_id");
		if (!clientId) {
			return { status: "invalid" };
		}
		const name = await clientName(auth, headers, clientId);
		if (!name) {
			return { status: "invalid" };
		}
		return {
			status: "ready",
			clientId,
			clientName: name,
			redirectHost: redirectHostOf(params),
			scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
			orgs: await memberOrgs(userId),
		};
	});

export const grantConsentOrgs = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { oauthQuery: string; orgIds: string[] }) => input)
	.handler(async ({ data }): Promise<{ ok: true }> => {
		const { auth, userId } = await sessionContext();
		const { verifySignedOAuthQuery } = await import(
			"@tripwire/auth/agent-auth"
		);
		const { secret } = await auth.$context;
		const clientId = new URLSearchParams(data.oauthQuery).get("client_id");
		if (
			!(clientId && (await verifySignedOAuthQuery(data.oauthQuery, secret)))
		) {
			throw new Error(
				"This sign-in link expired. Start again from your agent.",
			);
		}
		await grantOrgs(userId, clientId, data.orgIds);
		return { ok: true };
	});

export const getDeviceRequest = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { userCode: string }) => input)
	.handler(async ({ data }): Promise<AgentRequest> => {
		const { auth, headers, userId } = await sessionContext();
		try {
			const request = (await auth.api.deviceVerify({
				query: { user_code: data.userCode },
				headers,
			})) as { client_id?: string; scope?: string };
			const clientId = request.client_id;
			if (!clientId) {
				return { status: "invalid" };
			}
			return {
				status: "ready",
				clientId,
				clientName: (await clientName(auth, headers, clientId)) ?? clientId,
				redirectHost: null,
				scopes: (request.scope ?? "").split(" ").filter(Boolean),
				orgs: await memberOrgs(userId),
			};
		} catch {
			return { status: "invalid" };
		}
	});

export const grantDeviceOrgs = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { userCode: string; orgIds: string[] }) => input)
	.handler(async ({ data }): Promise<{ ok: true }> => {
		const { auth, headers, userId } = await sessionContext();
		const request = (await auth.api.deviceVerify({
			query: { user_code: data.userCode },
			headers,
		})) as { client_id?: string };
		if (!request.client_id) {
			throw new Error("This code expired. Run the sign-in command again.");
		}
		await grantOrgs(userId, request.client_id, data.orgIds);
		return { ok: true };
	});

export const listConnectedAgents = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<ConnectedAgent[]> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return [];
		}
		const { getDb } = await import("#/lib/server/db");
		const { agentServices } = await import("@tripwire/db");
		return await agentServices.listConnectedAgents(getDb().db, userId);
	});

export const revokeConnectedAgent = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { clientId: string }) => input)
	.handler(async ({ data }): Promise<{ ok: true }> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			throw new Error("Your session ended. Sign in again to continue.");
		}
		const { getDb } = await import("#/lib/server/db");
		const { agentServices } = await import("@tripwire/db");
		await agentServices.revokeAgent(getDb().db, {
			userId,
			clientId: data.clientId,
		});
		return { ok: true };
	});
