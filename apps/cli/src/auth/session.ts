import { type CredentialStore, credentialStore } from "#/auth/credentials";
import {
	type AuthDeps,
	AuthUnreachableError,
	refreshCredential,
} from "#/auth/device";
import { CLI_COMMAND, environment, mcpUrl } from "#/config";
import type { System } from "#/system";

export class NotSignedInError extends Error {
	constructor(message = `Not signed in. Run ${CLI_COMMAND} login.`) {
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
	const envToken =
		environment(system.env) === "staging"
			? system.env.TRIPWIRE_STAGING_TOKEN
			: system.env.TRIPWIRE_TOKEN;
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
				throw new NotSignedInError(
					`Session expired. Run ${CLI_COMMAND} login.`,
				);
			},
		);
		await store.write(fresh);
		return {
			token: fresh.accessToken,
			mcpUrl: url,
			source: store.kind,
		};
	}
	return {
		token: credential.accessToken,
		mcpUrl: url,
		source: store.kind,
	};
}
