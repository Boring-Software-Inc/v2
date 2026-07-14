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
