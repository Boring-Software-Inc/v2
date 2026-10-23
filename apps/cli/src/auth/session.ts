import { type CredentialStore, credentialStore } from "#/auth/credentials";
import {
	type AuthDeps,
	AuthUnreachableError,
	refreshCredential,
} from "#/auth/device";
import { mcpUrl } from "#/config";
import type { System } from "#/system";

export class NotSignedInError extends Error {
	constructor(message = "Not signed in. Run tripwire login.") {
		super(message);
		this.name = "NotSignedInError";
	}
}

export interface Session {
	token: string;
	mcpUrl: string;
	source: "env" | CredentialStore["kind"];
}

const SKEW_MS = 30_000;

export async function loadSession(
	system: System,
	deps: AuthDeps,
): Promise<Session> {
	const url = mcpUrl(system.env);
	const envToken = system.env.TRIPWIRE_TOKEN;
	if (envToken) {
		return { token: envToken, mcpUrl: url, source: "env" };
	}
	const store = credentialStore(system);
	const credential = await store.read();
	if (!credential) {
		throw new NotSignedInError();
	}
	if (credential.expiresAt && credential.expiresAt - SKEW_MS < deps.now()) {
		const fresh = await refreshCredential(deps, credential).catch(
			(error: unknown) => {
				if (error instanceof AuthUnreachableError) {
					throw error;
				}
				throw new NotSignedInError("Session expired. Run tripwire login.");
			},
		);
		await store.write(fresh);
		return {
			token: fresh.accessToken,
			mcpUrl: system.env.TRIPWIRE_MCP_URL || fresh.mcpUrl,
			source: store.kind,
		};
	}
	return {
		token: credential.accessToken,
		mcpUrl: system.env.TRIPWIRE_MCP_URL || credential.mcpUrl,
		source: store.kind,
	};
}
