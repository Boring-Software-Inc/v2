# tripwire e2e — the live harness (§11)

One funnel-driven CLI over **every state the GitHub App can produce**. It drives
**real pull requests** on a sacrificial repo, with real creds and a live
worker/webhook, and asserts against **real GitHub state** (`gh api` — check
conclusions, comment threads, review dismissals), never our DB.

This is a **pre-release / nightly** tool (§11 "live E2E"), not per-PR CI. The unit,
contract, snapshot, and integration suites run in CI via `bun test`
(`bun run test:suite`). This harness needs a human and a live deployment.

## The funnel — 3 prompts reach ~18 scenarios

```
bun run test                 interactive funnel
bun run test --list          the scenario registry
bun run test --only gate-block --expect block   headless, scriptable
bun run test --everything    every scriptable scenario, summary table
```

1. **axis** — the gate · the comment · the contributor · the edge cases · the hybrids
2. **outcome** (gate axis) — pass · block · needs review · degraded
3. **method** —
   - **construct it for me** — build a change that FORCES the outcome (wallet → block,
     clean doc → pass, forced read failure → degraded)
   - **I'll describe it** — you set up the PR by hand (on `TEST_BRANCH`), the harness
     asserts what SHOULD have happened. Same result diff.

Then: **plan** (what it will do + what it expects) → **confirm** (never opens a real
PR without showing the plan) → **run** (live progress) → **result diff** (✓/✗ per
assertion) → again / done (cleanup).

## Scenarios (the registry — `scenarios.ts`)

Scenarios are **data**, not a switch statement. Adding a state is a new entry with
`{ name, axis, plan, expects, needs, enableRules, run }` — never new menu code.

| axis | scenarios |
|---|---|
| **gate** | `gate-pass` · `gate-block` · `gate-needs-review` · `gate-degraded` |
| **comment** | `comment-lifecycle` (block→pass→block: supersede + resolution + dismissal) · `comment-idempotent` (N re-runs = 1 comment) |
| **contributor** | `contributor-fork` · `contributor-member` (exempt) · `contributor-stranger` · `contributor-bot` (hybrid) |
| **edge** | `edge-force-push` · `edge-draft` · `edge-closed` · `edge-reopened` · `edge-title-edit` · `edge-rate-limit` · `edge-private` |
| **hybrid** | `hybrid-uninstall` · `hybrid-rename` · `hybrid-merged-elsewhere` |

**Hybrids** need a human GitHub action mid-run. The harness prints
`[YOU: do X in GitHub — done?]`, waits, then asserts — the deploy-runbook pattern.
They only run interactively (or `--everything --with-hybrid` with a TTY).

## The two accounts

Tripwire exempts anyone with write+ access (maintainer/org member), so the pushing
actor must be **non-exempt** or nothing runs. Two ways:

- **Local (one account)** — push straight to `TEST_REPO` with the worker started as
  `TRIPWIRE_DISABLE_EXEMPTION=true` (dev only; refused in production). This is the
  default when `TEST_CONTRIBUTOR` is unset — the harness pushes `direct`.
- **Prod (two accounts)** — set `TEST_CONTRIBUTOR`; the harness `gh auth switch`es to
  it, forks `TEST_REPO`, and opens a **cross-repo PR from the fork** — genuinely
  non-exempt, so the gate fires even in production. Both accounts must be
  `gh auth login`'d. The `contributor-member` (exempt) scenario needs this mode.

Environment-agnostic scenarios pick the mode automatically: `fork` when
`TEST_CONTRIBUTOR` is set, else `direct`.

## The degraded floor

`gate-degraded` needs the worker started with **`TRIPWIRE_FAIL_READS=all`** (or
`diff,commits,contributor`) — a dev-only, non-production-gated env that forces the
context reads to throw, so ≥50% of rules skip and the verdict floors to
`needs_review`. Refused under `NODE_ENV=production`.

## Config (same surface as `test:lifecycle` — no new env)

| env | meaning | default |
|---|---|---|
| `TEST_REPO` | owner/name of the sacrificial repo | `Boring-Software-Inc/scratch` |
| `TEST_BASE` | base branch | repo default |
| `TEST_BRANCH` | head branch to assert in `describe` mode | `fix-typo` |
| `TEST_CONTRIBUTOR` | the non-exempt alt account → fork mode | — |
| `TEST_MAINTAINER` | account to restore/merge as | active at start |
| `TEST_WORKDIR` | clone dir | `$TMPDIR/tripwire-e2e` |
| `TEST_TIMEOUT_MS` | per-verdict wait | `120000` |
| `DATABASE_URL` | the DB the worker reads (to pin rule_configs) | — |

## CLI (clig.dev)

- `--only <scenario> [--expect <verdict>]` — headless; every interactive path has a
  flag equivalent. `--expect` guards the scenario's gate verdict.
- `--everything [--with-hybrid]` — run the scriptable set, print a summary with
  `--only` repro hints.
- `--no-input` — headless; requires `--only` or `--everything`.
- `--json` — machine-readable result.
- `--no-color` / `NO_COLOR` respected; colour + spinners only on a TTY.
- `--keep` — leave the PR open for inspection (no cleanup).
- **Exit 0** on all-pass, **non-zero** on any assertion failure — it can gate a
  release. Cleanup is idempotent and runs on interrupt.

## Folded-in

`test:run` and `test:lifecycle` are now this harness:

```
bun run test:run          → --only gate-pass       (a fresh run lands + passes)
bun run test:lifecycle    → --only comment-lifecycle
bun run test:lifecycle:prod  → same, with .env.e2e (fork mode)
```

`smoke:deploy` stays separate — it checks HTTP surfaces, not the PR flow.
