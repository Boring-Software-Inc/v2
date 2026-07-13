# tripwire

a firewall for your repo — a contribution gatekeeper that blocks, passes, or
sends change requests to review before they reach a maintainer.

## local development

### the demo (no docker, one command)

```
bun run dev:demo
```

A fully seeded, presentable app at http://localhost:3000 — the **web head only**
(no worker, no api, no queue). The database is embedded PGlite (in-process
Postgres, WASM) at `.demo/`, running the same schema and migrations as prod. It
seeds a realistic story (change requests across blocked / passed / sent-to-review,
an ai-review block with findings, a pending moderation item) and drops you on a
populated dashboard. Re-running resets to the same clean story.

In a dev build a **persona switcher** (bottom-left, and on `/login`) jumps between
the product's real states — fresh maintainer, one repo, many repos, empty
dashboard, active dashboard, and anonymous (the public-run stranger view). It is
dev-only (compile-time excluded from production, refused for non-local hosts).

### the full stack (docker + worker + api)

```
bun run db:up          # postgres in docker
bun run db:migrate     # apply migrations
bun run dev:api        # api head  (:8787)
bun run dev:worker     # worker (queue consumer)
bun run dev            # web head  (:3000)
```

Set `BETTER_AUTH_SECRET` to enable real GitHub sign-in and the auth gates; leave
it unset for the gateless "open-dev" posture.

## checks

```
bun run typecheck
bun run check              # biome
bun run check:boundaries   # §3 dependency arrows
bun test
```
