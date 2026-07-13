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

## live E2E (nightly / pre-release, not per-PR CI)

`bun test` proves the logic against a fake adapter. Two scripts prove the real
thing against GitHub — they are §11 "live E2E": they need real credentials, a
running worker, a tunnel routing the sacrificial repo's webhooks, and a pushing
account that is **not exempt** (not an org member / maintainer) on the repo, or
nothing trips.

```
bun run test:run         # push an empty commit → one fresh run lands
bun run test:lifecycle   # drive one PR through blocked → passed → blocked and
                         # assert the comment thread, the request-changes review,
                         # and the tripwire check against REAL GitHub state
```

`test:lifecycle` is the regression guard for the incident where a block→pass
resolution was edited in place and vanished (dither-kit#8). It exits non-zero on
any assertion failure and wipes its own PR/branch first, so re-running is a clean
slate. Config is env-routed (`TEST_REPO`, `TEST_BASE`, `TEST_LIFECYCLE_BRANCH`,
`TEST_WORKDIR`, `TEST_TIMEOUT_MS`); it trips `crypto-address` (a wallet address in
the diff), so it needs no `workflow` OAuth scope.

**Not automated (by design):** whether the copy READS well. The script proves the
mechanics — one comment vs. a struck-through supersede + a fresh resolution, the
dismissed review, the flipped check. A human reads the thread once; taste stays
human.
