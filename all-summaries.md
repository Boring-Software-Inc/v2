# all-summaries — autonomous run log

Append-only. One entry per build step (§13). Cross-refs: DECISIONS.md (ledger),
VERIFICATION-QUEUE.md (human tasks).

Run start: 2026-07-11. Starting state: step 1 committed (`0a4539e`), vocabulary
reconciliation + schema tightenings committed at run start (`280d08f`).

Environment notes at run start:
- Docker daemon was DOWN; launched Docker.app at run start.
- `~/tripwire-eve-demo` DOES NOT EXIST — step 9's port source is missing. The
  review process will be authored fresh from §8 and flagged (DECISIONS.md +
  queue). If the demo lives elsewhere, point step 9's rework at it.
- No old prod repo found on disk — step 5 rules are fresh implementations from
  the spec's rule names/semantics only (which §13.5 permits: "fresh
  implementations", old repo was reference-only anyway).

---

## Step 1 (prior sessions) — workspace + contracts + governance — 0a4539e, 280d08f

**Scope:** bun workspace per §3; demo → apps/web on mocks; mock shapes →
@tripwire/contracts (spec §4 vocabulary); AGENTS.md + .claude/ system;
boundary check; CI. Then: vocab reconciliation, provenance invariant, ranges,
ISO timestamps, forge-derived enum docs.

**Machine-verified (at 280d08f):**
```
$ biome check .        → Checked 201 files. No fixes applied.
$ bun run typecheck    → 10/10 workspaces exit 0
$ check:boundaries     → ✓ boundary check passed
$ bun test             → 9 pass, 0 fail (20 expect() calls)
mock-parse harness     → ALL MOCKS PARSE (14 items, 10 rules, 7 runs, 3 profiles…)
```

**Awaiting live verification:** none for step 1.

**Decisions:** see DECISIONS.md "Vocabulary reconciliation" + "Step-4 completion".

**Needs Grim's eyes:** contract schema shapes (flagged in DECISIONS.md);
`.claude/commands` wording; tripwire-design SKILL distillation.

---

## Step 2 — DB + local infra — 218f56e

**Scope:** full drizzle schema (13 tables: events, runs, run_steps, run_actions,
repos, rule_configs, workflow_definitions, moderation_items, rollups_daily,
user/session/account/verification + forge_identities), client + migrate,
generated migration 0000, .env.example, utils implemented with tests,
authored contracts/events.ts + Verdict.

**Machine-verified — done-when "migrations run clean locally":**
```
$ bun run db:migrate
@tripwire/db migrate: migrations applied
@tripwire/db migrate: Exited with code 0
$ bun run db:migrate   # second run — idempotent
@tripwire/db migrate: migrations applied
$ docker exec tripwire-postgres psql -U tripwire -d tripwire -c '\dt'
(14 rows: account, events, forge_identities, moderation_items, repos,
 rollups_daily, rule_configs, run_actions, run_steps, runs, session, user,
 verification, workflow_definitions)
```

**Awaiting live verification:** none (PlanetScale branch explicitly deferred by spec).

**Decisions:** DECISIONS.md "Step 2" — pg driver choice, Bun.randomUUIDv7,
AUTHORED events.ts + Verdict, RunLog* rename, per-run idempotency key.

**Needs Grim's eyes:** contracts/events.ts shape (authored); RunLog* naming
resolution; run_actions idempotency semantics.

**Checks:**
```
biome:      Checked 218 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      15 pass, 0 fail (49 expect) across 2 files
```

---

## Step 3 — GitHub App + ingest — 0715bb2

**Scope:** ForgeAdapter interface (forge); forge-github inbound: timing-safe
HMAC verify, normalize (GitHub → NormalizedEvent), App JWT + installation
token cache, captured fixture corpus + PROVENANCE.md; contracts/check.ts (§7
verbatim); db: pg-boss queue, events service (transactional insert+enqueue,
markEventNormalized+NOTIFY, quarantine, cursor listEvents), docker-cli test
postgres helper; api: Hono POST /webhooks/github per §5.1–5.4.

**Machine-verified — §11 integration on REAL postgres:**
```
bun test apps/api →
✓ verify → tx(insert + enqueue) → 200; row and job exist
✓ same delivery-id twice ⇒ still one row, one job, 200 duplicate
✓ bad signature ⇒ 401, nothing written
✓ missing signature ⇒ 401; missing headers ⇒ 400
4 pass, 0 fail [1.62s]
```
Fixture corpus (6 captured payloads) parses + normalizes:
```
bun test packages/forge-github → 8 pass, 0 fail
(opened/synchronize/closed/comment/push normalize + contract-parse; ping → null;
 malformed ingested payload throws)
```

**Awaiting live verification:** QUEUE #1 (register App), #2 (tunnel + webhook
URL), #3 (real PR ⇒ one row; redelivery ⇒ still one — the step-3 done-when).

**Decisions:** DECISIONS.md "Step 3" — transactional enqueue mechanics,
testcontainers dropped (hangs under Bun) for docker-cli helper, octokit
fixture provenance, authored check.ts, adapter mapping judgments, no octokit.

**Needs Grim's eyes:** contracts/check.ts (authored); ForgeAdapter surface;
normalize action→kind mapping (reopened/ready_for_review → opened).

**Checks:**
```
biome:      Checked 235 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      27 pass, 0 fail (84 expect) across 4 files
```

---

## Step 4 — Worker + live event list — dda5e16

**Scope:** worker process-event (normalize → NOTIFY / quarantine), api SSE
stream (LISTEN/NOTIFY), web /events surface (server fn + Query + SSE cache
merge, §9 route pattern, authored lib/seo.ts), Events nav entry.

**Machine-verified:**
Worker pipeline (§11 integration, real postgres):
```
bun test apps/worker →
✓ normalizes, writes cols + jsonb, and NOTIFYs 'events'
✓ re-processing a normalized event is a no-op
✓ malformed ingested payload ⇒ quarantined, raw untouched
✓ non-ingested kind (ping) stays un-normalized, not quarantined
4 pass, 0 fail [1.75s]
```
Local end-to-end smoke (api + worker + SSE on compose postgres):
```
$ curl -X POST /webhooks/github (signed fixture)  → {"ok":true,"duplicate":false}
$ psql: smoke-2 | change-request.opened | Codertocat/Hello-World | 2 | f
$ SSE listener captured: "kind":"change-request.opened" (1 event frame)
```

**Awaiting live verification:** QUEUE #4 — real PR appears in /events without
refresh (the step-4 done-when, needs the live App from #1–3).

**Decisions:** SSE over polling; NOTIFY colocated in db service; seo.ts
authored (demo had none); sanctioned useEffect for EventSource; server-only
db import pattern.

**Needs Grim's eyes:** /events page design fidelity (new surface built to the
tripwire-design skill); seo.ts (authored).

**Checks:**
```
biome:      Checked 246 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      31 pass, 0 fail (98 expect) across 5 files
```

---

## Step 5 — Rules registry — 6760718

**Scope:** defineRule + async evaluateRule (RuleResult envelope, skipped-not-
thrown), registry keyed id@version, RuleContext (clock as input), 8 rules at
@1 with per-rule unit tests over fixture contexts, scoring taxonomy + 0-100
composition with fast-check property tests.

**Machine-verified:**
```
bun test packages/core → 37 pass, 0 fail across 10 files [119ms]
(per-rule pass/block/skip/determinism; registry contents/lookup/validation;
 property tests: score ∈ [0,100], red flags never raise, determinism,
 missing-category degradation, clamping)
```

**Awaiting live verification:** none machine-blocked. NOTE: old prod repo not
on disk — rule semantics are fresh implementations, worth a skim.

**Decisions:** DECISIONS.md "Step 5" — RuleResult envelope authoring, zod +
fast-check in core, RuleContext duplication rationale, per-rule judgment calls,
fixture-context provenance, async evaluateRule.

**Needs Grim's eyes:** every rule's config/evidence schema (authored); the
english-only heuristic threshold; crypto-address pattern set; scoring weights
(equal split across present categories, worst-flag penalty).

**Checks:**
```
biome:      Checked 272 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      68 pass, 0 fail (161 expect) across 15 files
```

---

## Step 6 — Executor + hardcoded workflow — 497e80d

**Scope:** workflow DAG contract, validator (cycles/reachability/arity),
executor (topo walk, gate short-circuit, pause/resume, timed step records),
runs/repos db services (snapshot, evidence-validated steps, rows-first
actions), GithubReads, worker orchestration (join, exemption, degradation),
hand-seeded default workflow.

**Machine-verified — done-when "runs + steps persisted with workflow snapshot":**
```
bun test packages/core/src/workflow → 9 pass (pass/block/skip/pause+resume/
  timings; validate: cycles, unreachable, bad refs, misplaced approve edges)
bun test apps/worker →
✓ fresh-account PR ⇒ run persisted with snapshot, steps, verdict block, action row
    run.workflow_snapshot[0].id = "default@1", verdict=block,
    account-age evidence {accountAgeDays: 2}, block action status=recorded
✓ maintainer PR ⇒ exempt, no run
✓ degraded reads (all throw) ⇒ rules skip, run passes, nothing blocked
7 pass, 0 fail [1.69s]
```
(One transient failure in a combined run — parallel test containers; clean
rerun 80/80. Watch for flakiness.)

**Awaiting live verification:** reads against real GitHub (creds) — covered by
queue items; no new queue entry (step 7's live check covers the pipeline).

**Decisions:** DECISIONS.md "Step 6" — DAG semantics (skipped conducts as
pass), verdict derivation + join, resume model, injected evaluator, maintainer
exemption at run level, default workflow thresholds, fetch-only reads.

**Needs Grim's eyes:** workflow.ts contract (authored, review DAG semantics);
default workflow thresholds; exemption behavior (no run for maintainers).

**Checks:**
```
biome:      Checked 282 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      80 pass, 0 fail (199 expect) across 16 files
```

---

## Step 7 — Actions + the PR surface — 2400bdd

**Scope:** comment presenter + upsert, tripwire check run (pending → verdict,
per-SHA upsert), executeAction + assembled ForgeAdapter, worker pr-surface
(§5.6b pending check, §5.12 rows-first + mark-executed, §5.13 comment+check
from one persistence step).

**Machine-verified:**
```
bun test packages/forge-github → 17 pass (3 comment snapshots vs golden files;
  condensedness: exactly 3 lines — verdict+sentence / badge / marker;
  upsert creates-once-then-edits; check creates-then-patches same SHA;
  pending → in_progress without conclusion)
bun test apps/worker →
✓ blocked run ⇒ pending check, block+comment+check rows recorded AND executed;
  retry is a no-op (fake adapter call log: pending:sha → failure:sha,
  comment starts "**tripwire: blocked**"; all rows status=executed;
  re-emit executes nothing)
full suite: 90 pass, 0 fail — ran 4x consecutively clean after teardown
hardening (one intermittent teardown flake fixed)
```

**Awaiting live verification:** QUEUE #5 — the step-7 done-when (sockpuppet PR
blocked, required check kills merge button, new commit edits comment + fresh
check). Steps 1–7 = the MVP heartbeat; #5 is the heartbeat check.

**Decisions:** DECISIONS.md "Step 7" — block-is-the-check, verdict-scoped
idempotency keys, direct pending check, empty request-review payload,
GithubHttp extraction.

**Needs Grim's eyes:** comment copy (constitution voice); check summary
format; the block-action-does-nothing call.

**Checks:**
```
biome:      Checked 289 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      90 pass, 0 fail (3 snapshots, 221 expect)
```

---

## Step 8 — Run page + rules UI + auth — 205930c

**Scope:** Better Auth (createAuth in db, handler on api, session reads +
gate + login page + signOut in web, forge_identities hook), /runs/$runId with
real run_steps evidence rendering, /rules with per-repo config CRUD, rule
config schemas single-sourced in contracts (RULE_CATALOG).

**Machine-verified:**
```
typecheck 10/10 · biome clean (306 files) · boundaries ✓ ·
tests 90 pass, 0 fail
dev-server smoke: /login → 200, /rules → 200, /events → 200,
/runs/<missing-id> → 200 ("run not found" state)
core tests still green after config-schema move (46 pass)
```

**Awaiting live verification:** QUEUE #6 — GitHub OAuth app + real sign-in
(gate closes, forge_identities row appears); run page over a real blocked run
(part of #5's flow).

**Decisions:** DECISIONS.md "Step 8" — createAuth placement, auth proxy,
open-gate-when-unconfigured, config schemas → contracts, JSON-textarea config
editing.

**Needs Grim's eyes:** RULE_CATALOG copy + defaults (authored); the
open-gate fallback call; run page + rules page design fidelity (new
surfaces); auth stack (better-auth config).

**Checks:**
```
biome:      Checked 306 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      90 pass, 0 fail (3 snapshots, 221 expect)
```
