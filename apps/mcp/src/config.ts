import { TRIPWIRE_MCP_URL } from "@tripwire/contracts";

export interface McpConfig {
	port: number;
	resource: string;
	appUrl: string;
	issuer: string;
	jwksUrl: string;
	installStateSecret: string;
	githubAppSlug: string | undefined;
}

function trimSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export function readConfig(env: Record<string, string | undefined>): McpConfig {
	const appUrl = trimSlash(env.APP_URL ?? "https://app.tripwire.sh");
	const issuer = trimSlash(env.AUTH_ISSUER ?? `${appUrl}/api/auth`);
	const secret = env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			"BETTER_AUTH_SECRET is not set. The MCP head signs install links with it.",
		);
	}
	return {
		port: Number(env.PORT ?? 3421),
		resource: env.MCP_PUBLIC_URL ?? TRIPWIRE_MCP_URL,
		appUrl,
		issuer,
		jwksUrl: env.AUTH_JWKS_URL ?? `${issuer}/jwks`,
		installStateSecret: secret,
		githubAppSlug: env.GITHUB_APP_SLUG,
	};
}

export function protectedResourceMetadataUrl(resource: string): string {
	const url = new URL(resource);
	return `${url.origin}/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname}`;
}
