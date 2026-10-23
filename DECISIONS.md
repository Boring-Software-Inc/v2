# Decisions

Append-only. Every new dependency needs an entry here stating what it replaces
and why the stack (§2) can't do it — see `AGENTS.md`.

## 2026-07-28 — commitlint on the `commit-msg` hook

**Added:** `@commitlint/cli`, `@commitlint/config-conventional`,
`@commitlint/types` (root devDependencies).

**What it replaces:** nothing automated — the convention in `CLAUDE.md`
("include the task ID", conventional-commit shape) was documented but unenforced,
and `git log` shows the drift: `Update styles.css`, `bye bye dither button`,
`Update dashboard-layout.tsx`. Task IDs are how Median auto-transitions tasks, so
a malformed subject silently drops a task on the floor.

**Why the stack can't do it:** Biome lints source, not commit messages. Bun has
no commit-message hook. This is the only gate that runs before a commit object
exists.

**No husky.** The hook is a plain script at `scripts/githooks/commit-msg`, wired
by `git config core.hooksPath scripts/githooks` from the root `prepare` script,
so `bun install` sets it up for everyone. That avoids a fourth dependency and a
new top-level directory (§3 layout stays closed).

**Deviations from stock `config-conventional`**, both forced by existing practice:

1. `headerPattern` accepts an optional `ABC-123 ` prefix before the type, because
   this repo writes `TRP-83 feat(economics): …`. The stock parser reads that
   prefix as the type and rejects every such commit. The ticket is **optional** —
   `chore: bump deps` is legitimate. Set `REQUIRE_TICKET = true` in
   `commitlint.config.ts` to make it mandatory (both states are tested).
2. `design` joins the type enum; it is in active use on UI branches.

**Escape hatch:** `git commit --no-verify`.

## 2026-10-22 — agent setup: oauth provider, cimd, mcp sdk, api keys

Design: `docs/research/agent-setup.md`, approved by the founder 2026-10-22.

**Upgraded:** `better-auth` and `@better-auth/infra` to the 1.7 line
(`better-auth@1.7.12`, `@better-auth/infra@0.4.22`). The device grant for OAuth
clients and CIMD only exist in 1.7. Two API changes came with it: generic OAuth
providers sign in through `signIn.social` / `linkSocial` (callback path
`/callback/<id>`), and `unlinkAccount` takes the account row id.

**Added:** `@better-auth/oauth-provider` (packages/auth).
- Replaces: nothing. Tripwire had no way to issue tokens to an agent or CLI.
- Why the stack can't: better-auth sessions are browser cookies with full
  access. The MCP spec needs an OAuth 2.1 authorization server with PKCE,
  RFC 8707 audience-bound tokens, RFC 9728 discovery and rotating refresh
  tokens. Its `oauthDeviceAuthorization` gives the CLI the device grant; the
  standalone `device-authorization` plugin is not used because it returns a
  full session token.

**Added:** `@better-auth/cimd` (packages/auth).
- Replaces: dynamic client registration as the main client identity path.
- Why: the MCP 2026-07-28 spec makes client ID metadata documents the SHOULD
  and deprecates DCR. DCR stays on as the fallback for older clients.

**Added:** `@modelcontextprotocol/sdk` (apps/mcp).
- Replaces: nothing. `apps/mcp` is the new remote MCP head.
- Why: the official SDK implements the MCP protocol and the streamable HTTP
  transport. Hand-rolling JSON-RPC, capability negotiation and the transport is
  the kind of protocol code we should not own.

**Approved, not yet installed:** `@better-auth/api-key`.
- For: org-owned CI keys with an expiry (90 days default) and narrow
  permissions, sent through an env var.
- Lands with the CLI token commands. Nothing in this change needs it.

**New app:** `apps/mcp` (lifted off the cut list) and `apps/cli` (built
separately). See AGENTS.md.

**Lifetimes:** access token 15 minutes, refresh token 30 days absolute from
when the user connected the agent (enforced through `agent_grants`), device
code 10 minutes.

## 2026-10-22: `apps/cli`, the `tripwire` installer and terminal client

**Added:** a new app, `apps/cli`, published as `@tripwire-sh/cli` with the bin
`tripwire`. Approved by Grim for the agent setup work. Its devDependencies:
`@modelcontextprotocol/sdk`, `@clack/prompts`, `commander` (v14), `picocolors`,
`zod`. Bun bundles them into one ESM file (`dist/tripwire.js`), so the
published package has no runtime dependencies and runs under `npx` on Node 20.12+.

**What it replaces:** nothing. Today setup is only the web onboarding. The CLI
copies Sentry's `npx @sentry/agent-plugin install` flow, but with no plugins:
it adds the remote MCP server and the `tripwire-get-started` skill to each
agent directly.

**Why the stack can't do it:**

- `@modelcontextprotocol/sdk`: the management commands are an MCP client of
  the same server the agents use. Writing the streamable HTTP transport and
  JSON-RPC session by hand would be a second, untested MCP client.
- `@clack/prompts`: the agent multi-select and the confirm prompt need a raw
  mode TTY prompt. Already a root devDependency for `scripts/e2e`.
- `commander`: subcommands, `--help` and option parsing for 11 commands.
  Already a root devDependency. Pinned to v14 because v15 needs Node 22.12.
- `picocolors`: color that respects `NO_COLOR`. Already a root devDependency.
- `zod`: parses every external value (agent config files, OAuth responses,
  stored credentials, tool output). Already used by `@tripwire/contracts`.

**Boundaries:** `apps/cli` may import `@tripwire/contracts` only, so it can
share the setup prompt builder with the web app later.
