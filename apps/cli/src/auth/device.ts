import { z } from "zod";
import type { Credential } from "#/auth/credentials";
import { CLIENT_ID, SCOPES } from "#/config";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const deviceCodeSchema = z.object({
	device_code: z.string(),
	user_code: z.string(),
	verification_uri: z.string(),
	verification_uri_complete: z.string().optional(),
	expires_in: z.number(),
	interval: z.number().optional(),
});

export type DeviceCode = z.infer<typeof deviceCodeSchema>;

type JsonValue = z.infer<ReturnType<typeof z.json>>;

const tokenSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	expires_in: z.number().optional(),
	token_type: z.string().optional(),
});

const errorSchema = z.object({
	error: z.string(),
	error_description: z.string().optional(),
});

export interface AuthDeps {
	fetch(url: string, init: RequestInit): Promise<Response>;
	sleep(ms: number): Promise<void>;
	now(): number;
}

export const realAuthDeps: AuthDeps = {
	fetch: (input, init) => fetch(input, init),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
};

async function postForm(
	deps: AuthDeps,
	url: string,
	form: Record<string, string>,
): Promise<{ status: number; body: JsonValue }> {
	const response = await deps.fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			accept: "application/json",
		},
		body: new URLSearchParams(form).toString(),
	});
	const text = await response.text();
	const invalid = {
		error: "invalid_response",
		error_description: text.slice(0, 200),
	};
	try {
		const parsed = z.json().safeParse(JSON.parse(text));
		return {
			status: response.status,
			body: parsed.success ? parsed.data : invalid,
		};
	} catch {
		return { status: response.status, body: invalid };
	}
}

function oauthError(body: JsonValue, fallback: string): Error {
	const parsed = errorSchema.safeParse(body);
	if (!parsed.success) {
		return new Error(fallback);
	}
	return new Error(
		parsed.data.error_description
			? `${parsed.data.error}: ${parsed.data.error_description}`
			: parsed.data.error,
	);
}

export async function requestDeviceCode(
	deps: AuthDeps,
	authUrl: string,
	resource: string,
): Promise<DeviceCode> {
	const { status, body } = await postForm(deps, `${authUrl}/device/code`, {
		client_id: CLIENT_ID,
		scope: SCOPES,
		resource,
	});
	const parsed = deviceCodeSchema.safeParse(body);
	if (status >= 400 || !parsed.success) {
		throw oauthError(body, `Device authorization failed (HTTP ${status})`);
	}
	return parsed.data;
}

function toCredential(
	deps: AuthDeps,
	token: z.infer<typeof tokenSchema>,
	authUrl: string,
	resource: string,
	previousRefresh?: string,
): Credential {
	const refreshToken = token.refresh_token ?? previousRefresh;
	return {
		accessToken: token.access_token,
		refreshToken,
		expiresAt: token.expires_in
			? deps.now() + token.expires_in * 1000
			: undefined,
		mcpUrl: resource,
		authUrl,
	};
}

export async function pollForToken(
	deps: AuthDeps,
	authUrl: string,
	resource: string,
	code: DeviceCode,
): Promise<Credential> {
	let interval = (code.interval ?? 5) * 1000;
	const deadline = deps.now() + code.expires_in * 1000;
	while (deps.now() < deadline) {
		await deps.sleep(interval);
		const { status, body } = await postForm(deps, `${authUrl}/oauth2/token`, {
			grant_type: DEVICE_GRANT,
			device_code: code.device_code,
			client_id: CLIENT_ID,
			resource,
		});
		const token = tokenSchema.safeParse(body);
		if (status < 400 && token.success) {
			return toCredential(deps, token.data, authUrl, resource);
		}
		const error = errorSchema.safeParse(body);
		const kind = error.success ? error.data.error : "";
		if (kind === "authorization_pending") {
			continue;
		}
		if (kind === "slow_down") {
			interval += 5000;
			continue;
		}
		if (kind === "access_denied") {
			throw new Error("Sign-in was denied in the browser");
		}
		if (kind === "expired_token") {
			throw new Error("The code expired. Run tripwire login again.");
		}
		throw oauthError(body, `Token request failed (HTTP ${status})`);
	}
	throw new Error("The code expired. Run tripwire login again.");
}

export async function refreshCredential(
	deps: AuthDeps,
	credential: Credential,
): Promise<Credential> {
	if (!credential.refreshToken) {
		throw new Error("Session expired. Run tripwire login.");
	}
	const { status, body } = await postForm(
		deps,
		`${credential.authUrl}/oauth2/token`,
		{
			grant_type: "refresh_token",
			refresh_token: credential.refreshToken,
			client_id: CLIENT_ID,
			resource: credential.mcpUrl,
		},
	);
	const token = tokenSchema.safeParse(body);
	if (status >= 400 || !token.success) {
		throw new Error("Session expired. Run tripwire login.");
	}
	return toCredential(
		deps,
		token.data,
		credential.authUrl,
		credential.mcpUrl,
		credential.refreshToken,
	);
}

export async function revokeCredential(
	deps: AuthDeps,
	credential: Credential,
): Promise<void> {
	const token = credential.refreshToken ?? credential.accessToken;
	await postForm(deps, `${credential.authUrl}/oauth2/revoke`, {
		token,
		client_id: CLIENT_ID,
	}).catch(() => undefined);
}
