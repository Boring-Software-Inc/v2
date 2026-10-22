# tripwire

a firewall for your repo: a contribution gatekeeper that blocks or passes
change requests, or holds them for human review, before they reach a maintainer.

## local development

### the demo (no docker, one command)

```
bun run dev:demo
```

A fully seeded, presentable app at http://localhost:3000 — the **web head only**
(no worker, no api, no queue). The database is embedded PGlite (in-process
Postgres, WASM) at `.demo/`, running the same schema and migrations as prod. It
seeds a realistic story (change requests across blocked / passed / human review,
an ai-review block with findings, a pending human review item) and drops you on a
populated dashboard. Re-running resets to the same clean story.

In a dev build a **scenario switcher** (bottom-left, and on `/login`) resets the
demo data and seeds one product state: account (owner, member, outsider, signed
out), install, repos, workflows and the page to open, plus named presets and a
server-function delay. It is dev-only (compile-time excluded from production,
refused for non-local hosts).

### the full stack (docker + worker + api)

```
bun run db:up          # postgres in docker
bun run db:migrate     # apply migrations
bun run dev            # turbo: web (:3000) + api (:8787) + worker + cloudflared tunnel
```

`bun run dev` fans out through turbo — one interactive TUI, arrow keys switch
between the web/api/worker/tunnel panes. The `tunnel` pane prints a
`https://<random>.trycloudflare.com` URL routed to the api (:8787); point the
GitHub App webhook at `<that-url>/webhooks/github` to receive local deliveries.

```
bun run dev:local      # same, minus the cloudflared tunnel (offline)
bun run dev:web        # web head only (:3000)
bun run dev:api        # api head only (:8787)
bun run dev:worker     # worker only (queue consumer)
```

Set `BETTER_AUTH_SECRET` to enable real GitHub sign-in and the auth gates; leave
it unset for the gateless "open-dev" posture.

## unkey build secrets

`VITE_SITE_URL` and `VITE_WAITLIST_OPENER_ORIGINS` are inlined when the web
image builds. Unkey Compute does not pass Docker build args. It mounts the
environment as one secret file, and `apps/web/Dockerfile` sources that file
the way [Unkey build secrets](https://www.unkey.com/docs/compute/build/build-secrets)
describe. Set these on the **web** app's environment (production and preview):

| variable | value |
| --- | --- |
| `VITE_SITE_URL` | `https://app.tripwire.sh` |
| `VITE_WAITLIST_OPENER_ORIGINS` | `https://tripwire.sh,https://www.tripwire.sh` |

The landing site redirects apex to www, so the allowlist needs both origins.
The api and worker images do not inline these. A local `docker build` with no
secret uses `http://localhost:3000` and `http://localhost:3001`. `bun run dev`
reads `.env` and does not use this path. Railway can still pass the same two
names as build args.

```
docker build -f apps/web/Dockerfile \
  --build-arg UNKEY_SECRETS_ID=env \
  --secret id=env,src=.env \
  .
```

## checks

```
bun run typecheck
bun run check              # biome
bun run check:boundaries   # §3 dependency arrows
bun test
```

## live E2E (nightly / pre-release, not per-PR CI)

`bun test` (aka `bun run test:suite`) proves the logic against a fake adapter. One
funnel-driven harness proves the real thing against GitHub — §11 "live E2E": it
needs real credentials, a running worker, a tunnel routing the sacrificial repo's
webhooks, and a pushing account that is **not exempt** (not an org member /
maintainer) on the repo, or nothing trips.

```
bun run test                 # interactive funnel: axis → outcome → method
bun run test --list          # the scenario registry (~18 states)
bun run test --only gate-block --expect block   # headless, scriptable
bun run test --everything    # every scriptable scenario + a summary table

bun run test:run             # → --only gate-pass       (a fresh run lands + passes)
bun run test:lifecycle       # → --only comment-lifecycle
```

Three prompts reach ~18 scenarios across the gate, the comment, the contributor,
the edge cases, and the hybrids (which hand off a human GitHub action mid-run).
Scenarios are **data** (`scripts/e2e/scenarios.ts`) — adding a state is a new
entry, not new menu code. Assertions read **real GitHub state** via `gh api`; the
run exits non-zero on any failure, so it can gate a release. Full docs, the two
accounts, and the degraded-floor hook: **`scripts/e2e/README.md`**.

`comment-lifecycle` is the regression guard for the incident where a block→pass
resolution was edited in place and vanished (dither-kit#8). Cleanup is idempotent
and fires on interrupt — re-running is a clean slate.

**Not automated (by design):** whether the copy READS well. The harness proves the
mechanics — one comment vs. a struck-through supersede + a fresh resolution, the
dismissed review, the flipped check. A human reads the thread once; taste stays
human.
