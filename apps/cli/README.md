# Tripwire CLI

Install globally with npm to run `tripwire` from your terminal.

```sh
npm install -g @tripwire-sh/cli
tripwire login
```

You can also run `npx @tripwire-sh/cli@latest login` without a global install.

For TypeScript workflows, install the SDK in your project with
`npm install @tripwire-sh/sdk@latest`. Workflow commands require SDK 0.1.2 or
later and use the version resolved from each workflow file.

Install the staging release with `npm install -g @tripwire-sh/cli@staging`,
then run `tripwire-staging login` and sign in with your staging account.
Use `tripwire-staging status` to check your session and
`tripwire-staging install` to set up coding agents.

To keep both releases on macOS or Linux, install staging to a separate npm
prefix and add its bin directory to your shell's PATH:

```sh
npm install -g --prefix "$HOME/.local/tripwire-staging" @tripwire-sh/cli@staging
export PATH="$HOME/.local/tripwire-staging/bin:$PATH"
tripwire-staging --version
```

For a one-off run, use `npx @tripwire-sh/cli@staging login`. Both CLI channels
use the same `@tripwire-sh/sdk` package in your project.

The staging release defaults to MCP at
`https://tripwire-mcp-preview-tripwire.unkey.app/mcp` and auth at
`https://staging.tripwire.sh/api/auth`. These match the Unkey preview deployment
and its OAuth discovery metadata. Production defaults stay at
`https://mcp.tripwire.sh/mcp` and `https://app.tripwire.sh/api/auth`.

Staging installs the MCP server as `tripwire-staging` and the skills as
`tripwire-staging-get-started` and `tripwire-staging-workflows`, alongside the
production entries. For example, sign the staging MCP in with
`codex mcp login tripwire-staging` or `claude mcp login tripwire-staging`.

Credentials are separate in the macOS keychain, Linux Secret Service and the
file fallback. Production keeps `tripwire-cli` / `default` and
`~/.config/tripwire/credentials.json`. Other targets use an account and filename
containing the environment and a hash of the auth and MCP URLs. A stored
credential must match both configured URLs before it can be used or revoked.
`XDG_CONFIG_HOME` and `TRIPWIRE_CREDENTIAL_STORE=file` still apply.

For CI, staging reads `TRIPWIRE_STAGING_TOKEN`; production reads `TRIPWIRE_TOKEN`.
Staging ignores `TRIPWIRE_TOKEN`. Keep tokens in the CI secret store.

`TRIPWIRE_ENV=staging` also selects staging when running from source, for example
`TRIPWIRE_ENV=staging bun run apps/cli/src/index.ts login`. Explicit
`TRIPWIRE_MCP_URL` and `TRIPWIRE_AUTH_URL` overrides still work, with separate
credentials for each URL pair. Existing production credentials continue to work;
custom URL overrides require a fresh login rather than reusing the old singleton.

## Release

After the changes you want to release are merged into `staging`, run:

```sh
bun run cli:release patch --staging
```

This dispatches the existing `release-cli.yml` workflow on `staging`
with `channel=staging`. The equivalent command is:

```sh
gh workflow run release-cli.yml --ref staging -f channel=staging -f bump=patch
```

The workflow checks the CLI, chooses a version such as `0.1.1-staging.42`, bundles
it and publishes `@tripwire-sh/cli` with npm tag `staging`. It creates a GitHub
prerelease. The `latest` tag stays on production. Publishing requires the existing
npm trusted publisher and the repository's `npm` environment to allow the staging
branch. `bun run cli:release patch --staging --dry-run` checks version selection
without dispatching.

For a local package, run `bun run scripts/cli-release/prepare.ts bump patch staging`,
then `bun run --cwd apps/cli build` and `npm pack ./apps/cli`. The prepare step
changes the local package version; restore it after packing. The tarball runs with
`npx --package /absolute/path/to/tripwire-sh-cli-VERSION.tgz tripwire-staging login`.
