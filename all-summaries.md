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
