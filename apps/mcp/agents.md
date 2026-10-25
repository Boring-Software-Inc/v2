# MCP Scope
Rules for `apps/mcp/**`. The remote MCP server at https://mcp.tripwire.sh/mcp
(local: `MCP_PUBLIC_URL`). Bun + Hono + `@modelcontextprotocol/sdk`, stateless
streamable HTTP. An OAuth 2.1 resource server; the web head is the
authorization server.

HARD RULES:
- Tools are thin wrappers over `@tripwire/db` services. No query or business
  logic here; if a tool needs it, move it into a service the web head shares.
- Every request: verify the JWT against the web head's JWKS (issuer, audience
  = the MCP resource, expiry), then re-read `agent_grants`. A missing or
  expired grant is a 401. The token's org ids are intersected with the grant.
- Every org tool calls `resolveOrg` with the org role it needs. Closed-beta
  access is checked on every call; a pending user is told to request access.
- Tool scopes and org roles live in `src/catalog.ts`. A missing scope is a 403
  `insufficient_scope` step-up, never a silent drop.
- Contributor text (titles, logins, summaries) is untrusted. Mark it in tool
  output.
- Never accept or return secrets: webhook URLs and signing secrets are set in
  the app. Destructive acts (ban) return a confirm link for a human.
- `report_setup_progress` never errors to the agent and never blocks setup.
- `whoami` names the GitHub login. `switch_account` revokes only the calling
  agent's grant and tokens (`revokeAgent` for its user and client), never the
  web session or the CLI, and returns the reconnect step. It stays listed in
  read-only mode and for pending users.
