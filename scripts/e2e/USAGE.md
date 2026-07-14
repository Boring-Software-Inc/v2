# Using the live E2E harness

How to actually run `bun run test` — from "poke at it safely" to a real live run.
Reference (scenarios, config table, the two accounts): **`README.md`** next to this.

> **§11 live tool.** It drives REAL pull requests on a sacrificial repo with real
> creds and a live worker/webhook. Not per-PR CI — the unit/integration suite is
> `bun test` (aka `bun run test:suite`).

## 1. Explore safely — no infra, no PRs

```bash
bun run test --list      # the ~18 scenarios + which are skipped and why
bun run test             # the funnel; back out at the confirm prompt
```

`--list` and the funnel up to the **confirm** step (`this opens a REAL pull
request`) touch nothing. Nothing opens a PR until you say yes.

## 2. A real live run — the loop it needs

A scenario needs the **whole loop live**: your push → GitHub → webhook → a worker →
a check on the PR, which the harness reads back with `gh api`.

**The gotcha:** once deployed, the GitHub App posts webhooks to your *deployed*
instance (Railway), so a LOCAL worker never sees them. A real PR fires zero local
webhooks. Give the harness a loop it can actually see:

### Option A — borrow the webhook locally (temporary)

1. Bring the stack up:
   ```bash
   bun run db:up && bun run db:migrate
   bun run dev:api                                    # :8787
   TRIPWIRE_DISABLE_EXEMPTION=true bun run dev:worker  # a maintainer is exempt → the flag makes you non-exempt
   ```
2. **Repoint the GitHub App's webhook URL** at a tunnel → `localhost:8787`
   (e.g. cloudflared). **Repoint it back to Railway when you're done.**
3. First-run prerequisites on a fresh local DB (the gate won't fire without these):
   - the repo must be **synced** — open any PR once so the worker records it;
   - the repo must be **armed** — toggle it in the dashboard, or
     `repoServices.setRepoArmed(db, repoId, true)`.
4. Run it:
   ```bash
   bun run test --only gate-block --expect block
   ```

### Option B — a dedicated sacrificial repo

Give the harness its OWN repo with its OWN dev App install whose webhook points at
your tunnel. No repointing of prod. This is the durable setup — **live E2E is now a
deployed-instance activity, so it needs its own webhook path** (see DECISIONS).

> **Never point the harness at the production DB.** `test:lifecycle:prod` pins +
> snapshot/restores `rule_configs` on the live PlanetScale DB now gating a real
> repo; a half-failed restore leaves prod misconfigured. Not worth it to prove a
> test harness works.

## 3. Headless / scriptable (clig.dev)

```bash
bun run test --only gate-block --expect block --json   # one scenario, machine-readable
bun run test --everything                              # all scriptable, summary table
bun run test --everything --with-hybrid                # + the human-in-the-loop ones
bun run test --only comment-lifecycle --no-input       # what test:lifecycle delegates to
```

Exit **0** = all pass, **non-zero** = any failure — so it can gate a release.
`--no-input` requires `--only`/`--everything`; `NO_COLOR`/`--no-color` respected;
colour + spinners only on a TTY; `--keep` leaves the PR open for inspection.

## 4. Scenario → what it needs

| want | command | needs |
|---|---|---|
| block / pass | `--only gate-block` · `gate-pass` | DB + api + worker (`TRIPWIRE_DISABLE_EXEMPTION` locally) |
| degraded floor | `--only gate-degraded` | worker started with `TRIPWIRE_FAIL_READS=all` |
| fork / stranger / exempt-member | `--only contributor-fork` … | `TEST_CONTRIBUTOR` set (2nd account) |
| comment lifecycle | `--only comment-lifecycle` | same as block |
| uninstall / rename / merged-elsewhere | funnel → hybrids | interactive (prints `[YOU: do X — done?]`) |

## 5. Folded-in

`test:run` and `test:lifecycle` are this harness now:

```
bun run test:run            → --only gate-pass         (a fresh run lands + passes)
bun run test:lifecycle      → --only comment-lifecycle
bun run test:lifecycle:prod → same, with .env.e2e      (fork mode; hits PROD — see the warning above)
```

`smoke:deploy` stays separate — it checks HTTP surfaces, not the PR flow.

## 6. Preflights

Before opening a real PR, a db-backed scenario probes and fails fast:

- **`DATABASE_URL`** — a `select 1` (needed to pin rule_configs);
- **`TEST_API_URL/healthz`** — the webhook receiver (a down API means no webhook
  lands, so no run).

The **worker** has no HTTP surface — its silence still surfaces as the
`no run in 60s — worker up?` verdict timeout. The preflights can't detect that
GitHub is posting webhooks *elsewhere* (Option A/B) — that stays your call.
