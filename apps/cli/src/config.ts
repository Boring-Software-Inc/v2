import pkg from "../package.json" with { type: "json" };

export const VERSION = pkg.version;
export const SERVER_NAME = "tripwire";
export const SKILL_NAME = "tripwire-get-started";
export const WORKFLOWS_SKILL_NAME = "tripwire-workflows";
export const CLIENT_ID = "tripwire-cli";
const DEFAULT_MCP_URL = "https://mcp.tripwire.sh/mcp";
const DEFAULT_AUTH_URL = "https://app.tripwire.sh/api/auth";
export const SCOPES =
	"offline_access tripwire:read tripwire:configure tripwire:moderate tripwire:admin";

export function mcpUrl(env: NodeJS.ProcessEnv): string {
	return env.TRIPWIRE_MCP_URL || DEFAULT_MCP_URL;
}

export function authUrl(env: NodeJS.ProcessEnv): string {
	return (env.TRIPWIRE_AUTH_URL || DEFAULT_AUTH_URL).replace(/\/+$/, "");
}
