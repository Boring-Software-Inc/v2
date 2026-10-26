import pkg from "../package.json" with { type: "json" };

export const VERSION = pkg.version;
const DEFAULT_ENVIRONMENT = VERSION.includes("-staging.")
	? "staging"
	: "production";

export function environment(env: NodeJS.ProcessEnv): "production" | "staging" {
	const value = env.TRIPWIRE_ENV || DEFAULT_ENVIRONMENT;
	if (value !== "production" && value !== "staging") {
		throw new Error("TRIPWIRE_ENV must be production or staging");
	}
	return value;
}

export const IS_STAGING = environment(process.env) === "staging";
export const CLI_COMMAND = IS_STAGING
	? "npx @tripwire-sh/cli@staging"
	: "tripwire";
export const SERVER_NAME = IS_STAGING ? "tripwire-staging" : "tripwire";
export const SKILL_NAME = IS_STAGING
	? "tripwire-staging-get-started"
	: "tripwire-get-started";
export const WORKFLOWS_SKILL_NAME = IS_STAGING
	? "tripwire-staging-workflows"
	: "tripwire-workflows";
export const CLIENT_ID = "tripwire-cli";
export const PRODUCTION_MCP_URL = "https://mcp.tripwire.sh/mcp";
export const PRODUCTION_AUTH_URL = "https://app.tripwire.sh/api/auth";
const STAGING_MCP_URL = "https://tripwire-mcp-preview-tripwire.unkey.app/mcp";
const STAGING_AUTH_URL = "https://staging.tripwire.sh/api/auth";
export const SCOPES =
	"offline_access tripwire:read tripwire:configure tripwire:moderate tripwire:admin";

export function mcpUrl(env: NodeJS.ProcessEnv): string {
	return (
		env.TRIPWIRE_MCP_URL ||
		(environment(env) === "staging" ? STAGING_MCP_URL : PRODUCTION_MCP_URL)
	).replace(/\/+$/, "");
}

export function authUrl(env: NodeJS.ProcessEnv): string {
	return (
		env.TRIPWIRE_AUTH_URL ||
		(environment(env) === "staging" ? STAGING_AUTH_URL : PRODUCTION_AUTH_URL)
	).replace(/\/+$/, "");
}
