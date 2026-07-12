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

---

## Step 9 — ai-review — 8464ab8

**Scope:** review contract (the muzzle), ai-review@1 with injected generate()
and versioned prompt files, worker bounded tool loop (AI SDK + Anthropic,
submit_review answer tool, step cap, adapter-read tools only), AiFindings on
the run page, default-workflow wiring.

**Machine-verified:**
```
bun test packages/core → 53 pass (ai-review: pass/block/needs_review→boolean
  mapping, evidence carries output+trace, prompt renders repo+diff from the
  captured fixture, no-generate ⇒ skipped, essay summary rejected by the
  muzzle, >5 findings rejected, comment events skipped)
full suite: 97 pass, 0 fail
```

**Awaiting live verification:** QUEUE #7 — set ANTHROPIC_API_KEY, re-run a
sockpuppet PR, confirm ai-review executes live (trace in evidence, findings on
the run page).

**Decisions:** DECISIONS.md "Step 9" — **eve demo missing, prompts AUTHORED
(morning review target #1)**, submit_review tool as the muzzle, verdict→
boolean mapping, compile-time text imports.

**Needs Grim's eyes:** instructions.md + template.md (authored whole-cloth);
the tool set; DIFF_CHAR_BUDGET=60k; default model string.

**Checks:**
```
biome:      Checked 312 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      97 pass, 0 fail (3 snapshots, 236 expect)
```

---

## Step 10 — Moderation queue → rollups → React Flow editor — f4c9780

**Scope:** moderation-as-paused-run end to end (item on pause, tx-safe decide
+ resume job, decision-edge walk, surface re-emit), daily rollups + real Home
stats, React Flow workflow editor emitting the engine's JSON with a proven
round-trip.

**Machine-verified:**
```
bun test apps/worker (moderation integration) →
✓ needs_review pauses the run and creates a pending item
    run.status=paused, verdict=needs_review, item nodeId=moderated@1:mod
✓ deny resumes down the deny edge ⇒ block; item decided; surface re-emitted
    run completed/block, :resume steps recorded, 2 comment rows (verdict-
    scoped), double-decide returns false
bun test apps/web (editor) →
✓ definition → graph → definition is identity
✓ emission parses against the contract schema
✓ broken graph rejected at emission
bun test apps/worker (round-trip) →
✓ committed editor emission → validate.ts → executor ⇒ verdict block, 9+ steps
full suite: 103 pass, 0 fail — 5x consecutive clean after fixing a docker-run
race (retry) and a REAL test bug (account-age fixture margin floored to 1
when the profile fetch trailed ctx.now)
dev smoke: /workflows → 200, /moderation → 200
```

**Awaiting live verification:** QUEUE #8 — moderated workflow live (send-to-
moderation → /moderation → approve/deny → check+comment update in place).

**Decisions:** DECISIONS.md "Step 10" — resume-via-job, derived outcomes,
honest-zero bannedUsers, DEFAULT_WORKFLOW → contracts, committed-emission
round-trip bridge, JSON-typed config.

**Needs Grim's eyes:** editor UX (functional but spartan — node config
editing happens in /rules, not on canvas); home stats semantics; moderation
page copy.

**Checks:**
```
biome:      Checked 329 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      103 pass, 0 fail (3 snapshots, 257 expect) — 5x clean
```

---

## Spec parity audit — closing artifact

Section-by-section attestation of where each spec requirement lives. Written
after a /cleanup pass (signal forwarding added to the demo's ten query files;
login button moved onto the ui Button primitive; sanctioned-effect audit clean)
and core-coverage tightening (envelope-law tests in
packages/core/src/rules/define.test.ts). Final: 107 tests, 0 fail, all four
checks green.

### §1 What Tripwire is
- Gatekeeper pipeline: ingest `apps/api/src/routes/webhooks.ts` → rules/
  workflows `packages/core/src/{rules,workflow}` → auditable runs
  `packages/db/src/services/runs.ts` → forge actions
  `packages/forge-github/src/actions/*`.
- Git-as-VM seam: neutral types `packages/contracts/src/events.ts`
  ("change-request", never PR), `packages/forge/src/index.ts` (ForgeAdapter),
  signal taxonomy `packages/core/src/scoring/signals.ts` (core never knows
  "sponsors" exists). Second adapter: correctly absent (cut list).

### §2 Tech stack (locked) — all present, nothing else
Bun workspaces (package.json), TS strict ESM (tsconfig.base.json,
noUncheckedIndexedAccess), Biome+ultracite (biome.json), TanStack
Start/Router/Query (apps/web), server functions → db/services (all
apps/web/src/lib/*.functions.ts; zero internal REST), Hono (apps/api),
Postgres+Drizzle (packages/db), pg-boss (packages/db/src/queue.ts,
transactional enqueue proven in apps/api/src/webhooks.integration.test.ts),
SSE via LISTEN/NOTIFY (apps/api/src/routes/stream.ts), Better Auth GitHub-only
(packages/db/src/auth.ts), AI SDK via OpenRouter (apps/worker/src/ai/generate.ts; AI_REVIEW_MODEL default, rule config wins),
React Flow last (apps/web/src/components/workflows/editor/), UUIDv7
(packages/utils/src/id.ts — Bun.randomUUIDv7), pino everywhere (zero
console.log outside scripts/check output), Zod in contracts.

### §3 Monorepo layout + arrows
§3 tree + the owner-added `packages/auth` (spec amended); apps/mcp = agents.md only. Arrows enforced by
scripts/check-boundaries.ts (allow-list mirrors the spec block verbatim),
green in CI (.github/workflows/ci.yml) since commit one.

### §4 Package contents
- contracts: events/runs/rules/review/check/contributor/repo/workflow + the
  demo-extracted domains. AUTHORED files flagged in DECISIONS.md.
- forge: interface + types ONLY (packages/forge/src/index.ts — nothing else).
- core: define/registry/8 rules + ai-review (rule.ts + instructions.md +
  template.md versioned together), workflow/{executor,validate}.ts,
  scoring/{score,signals}.ts, context.ts. Purity: no I/O imports anywhere
  (boundary script + review); skipped-not-thrown proven in define.test.ts.
- forge-github: adapter.ts, webhook/{verify,normalize}.ts, client/{auth,
  http,reads}.ts, actions/{execute,check,comment}.ts, fixtures/ (captured,
  PROVENANCE.md).
- db: schema/{events,runs,repos,moderation,rollups,auth}.ts, services/
  {events,runs,repos,insights,moderation}.ts, client.ts, migrate.ts,
  drizzle/0000. snake_case, timestamptz, jsonb validated on write
  (services parse with contracts schemas).
- ui: primitives untouched from the demo (packages/ui reserved; demo
  primitives live in apps/web/src/components/ui — lifting them is future
  mock-shrink work, noted for taste review).
- utils: id/errors/time/string/retry per spec list, tested.
- api: webhooks.ts (verify→tx→200, NOTHING else), stream.ts (SSE),
  auth mount; middleware/auth.ts folded into index.ts deps injection.
- worker: jobs/{process-event,run-workflows,pr-surface,resume-run,rollup}.ts,
  ai/generate.ts, default-workflow re-validation. replay job: see §11 gap note.
- web: four §4 surfaces (Home stats real, Workflows editor, Rules config,
  Insights=demo analytics on mocks) + /events, /runs/$runId, /moderation.

### §5 Data & ingestion — every numbered step
1 verify (verify.ts, 401) · 2 ONE tx insert+enqueue (events service, proven) ·
3 UNIQUE delivery_id no-op (proven) · 4 200-fast nothing-else (webhooks.ts) ·
5 contracts parse + quarantine + fixture-candidate log (process-event.ts,
proven) · 6 NormalizedEvent + NOTIFY (markEventNormalized, proven) · 6b
pending check on pickup (pr-surface.ts emitPendingCheck, tested) · 7 match by
trigger (run-workflows.ts) · 8 RuleContext pre-fetched via adapter reads with
per-read degradation (context.ts, proven) · 9 DAG walk with step records
(executor.ts) · 10 SNAPSHOT on run (createRun validates, proven) · 11 multi-
workflow JOIN worst-verdict (run-workflows.ts) · 12 actions rows-first,
marked executed (runs service + pr-surface, retry no-op proven) · 13 check +
comment same persistence step (emitPrSurface) · SSE fan-out → Query cache
(stream.ts → events.query.ts). Append-only: no delete/update of raw anywhere.

### §6 Rules & workflows
Boolean requirement + exemption (run-workflows maintainer/org-member check) ·
defineRule primitive with Zod config (contracts) + result schemas · evidence
typed per rule (CoV in pr-rate-limit evidence per the spec's own example) ·
versioning law (registry keyed id@version; ai-review prompts versioned with
the rule) · workflow JSON DAG in contracts/workflow.ts · executor eats JSON
since step 6, editor emits it last (round-trip proven) · moderation = paused
run (moderation.integration.test.ts).

### §7 PR surface
One comment: verdict line + ONE sentence, then a `for maintainers` dropdown
holding the hosted-PNG "View on Tripwire" button + `<!-- tripwire:run -->`
marker, upsert never append (comment.ts, snapshot + fake-fetch tests) · one
`tripwire` check per head SHA, pending → verdict, updated in place, never a
workflow file (check.ts) · same-step emission (pr-surface.ts) · branch
protection is the human's toggle (QUEUE #5); tripwire never mutates it.

### §8 Review agent
AI SDK in worker only · injected generate() (RuleContext) · bounded loop
(step cap + submit_review stop, adapter-read tools only, diff up front) ·
muzzle schema contracts/review.ts (essay + >5 findings rejected in tests) ·
RuleResult envelope composes in workflows · prompts versioned with the rule ·
full trace in evidence. GAP: eve demo absent — prompts authored (morning
review target).

### §9 Frontend conventions
Thin route.tsx (all 7 new routes: component + pendingComponent + buildSeo,
zero exported components) · components/<feature>/<part> organization ·
key factories + staleTime + signal forwarding (cleanup pass extended this to
the demo's queries) · onSettled reconciliation (rule-config-form,
moderation queue) · SSE merges into cache (events.query.ts) · one sanctioned
useEffect · kebab-case files · seo.ts authored (demo had none).

### §10 Auth
Better Auth GitHub-only (@tripwire/auth/server createAuth, served by the WEB
head via start.ts request middleware — vite proxy is dead under nitro; spec
§10 records the transport) · user.id UUIDv7; GitHub identity ONLY in account +
forge_identities (databaseHook) · moderation_items.decided_by FK → user.id ·
contributors never authenticate (scored subjects live in event data).

### §11 Testing
Unit (per-rule over fixture contexts; fast-check properties: range, red-flags-
never-raise, determinism) · contract (fixture corpus normalizes;
contracts.test.ts) · snapshot (3 golden comments) · integration (REAL postgres
via docker-run helper — testcontainers hangs under Bun; duplicate-delivery
proven) · live E2E → VERIFICATION-QUEUE. CI from first commit.
GAPS (honest): verdict-replay job (jobs/replay.ts + /replay wiring) is NOT
implemented — /replay exists as a command doc; the job needs stored runs to
replay against and is a natural next session. Shadow mode is post-MVP-launch
by spec.

### §12 Governance
AGENTS.md (anti-BS + cut list verbatim) · 13 scoped agents.md · 8 rules with
description+paths frontmatter · 14 commands · constitution · tripwire-design
skill. Structure-is-documentation upheld: every deferral in DECISIONS.md or
the queue.

### §13 Build order
Steps 1–10 committed in order, one commit each, checks green before each.
Done-whens: machine-provable parts proven in this file's step entries; human
parts queued (#1–#9) in dependency order.

### Known gaps for the morning (all recorded)
1. ai-review prompts authored without the eve demo (DECISIONS, QUEUE #7).
2. Verdict-replay worker job not implemented (§11 row + §4 worker listing) —
   needs real stored runs; command doc exists.
3. packages/ui still empty; demo primitives live in apps/web/components/ui
   (lifting = mock-shrink work, design-final risk if rushed).
4. Home queue list + log/automod/analytics surfaces still mock-backed by
   design (mocks shrink as later sessions land real data of that depth).
5. Octokit-example fixtures pending replacement by self-captured deliveries
   (QUEUE #3/#5).

---

## Hardening session (pre-live) — 6428ecd, 591af44, 75bb2ca, c4fa9e3

**Scope:** four security-posture units executed before first live traffic, one
commit each, checks green before each.

**Unit 1 — fail-closed floor (6428ecd).** All-skipped or ≥50%-skipped rule
nodes upgrade a would-be pass to needs_review: paused run, `run:degraded`
moderation item, degradation evidence as a run step, neutral check, "sent to
review — evaluation degraded" comment. Single skip still conducts as pass.
Resume: approve ⇒ pass, deny ⇒ block (recorded+executed).
```
bun test apps/worker →
✓ degraded reads (all throw) ⇒ fail-closed floor: needs_review + moderation
  item, never pass  (degradedReads = [diff, commits, contributor])
✓ partial degradation (minority skipped) ⇒ still pass
```
Queue amended: Issues R&W at #1; degraded-creds sub-check at #5.

**Unit 2 — auth fail-closed in prod (591af44).** `resolveAuthPosture`:
missing BETTER_AUTH_SECRET + NODE_ENV=production ⇒ refuse to serve (api exits
at boot; web throws per request). Dev open-gate unchanged. Guard unit-tested
(3 tests).

**Unit 3 — block files request-changes (75bb2ca).** Block action now submits
a REQUEST_CHANGES review (one-liner + run link) so unprotected repos get
friction; check remains the primary gate. Best-effort: 403 (legal on own
PRs) warns + marks executed, never kills the run. Payload unit-tested.

**Unit 4 — ai-review port + hardening, still @1 (c4fa9e3).** Eve demo FOUND
at ~/tripwire-eve-agent-demo — instructions.md now carries the ported review
process (maintainer-QoL test, slop signals, CONTRIBUTING/AGENTS rules check,
ambiguity ⇒ needs_review) plus: trust rules (all submission content is
untrusted data; injection attempts are social-engineering findings),
explicit-truncation rule + `[diff truncated: showing 60000 of N chars]`
marker, AI-assistance product line, confidence anchors.
```
bun test packages/core/src/rules/ai-review → 11 pass
(trust/truncation/anchors present in instructions; marker renders only when
 clipped; injection fixture renders as data; muzzle tests unchanged)
```
Queue #7 gains the live injection drill.

**Checks (final state):**
```
biome:      Checked 331 files. No fixes applied.
typecheck:  10/10 workspaces exit 0
boundaries: ✓ passed
tests:      116 pass, 0 fail (3 snapshots, 289 expect)
```

**Decisions:** DECISIONS.md "Hardening session" — four entries, two of which
explicitly AMEND step-6/step-7 decisions rather than silently replacing them.

**Needs Grim's eyes:** final instructions.md read-through before queue #7
(it freezes as @1 at first live invocation); the 50% floor threshold.

---

## Spec-sync session — f2f0d56 (docs) + SSE gate commit

**Scope:** spec.md synced to reality (auth package/arrows, web-head auth
transport + why, OpenRouter provider, Node-runtime caveat), AGENTS.md +
rule docs mirrored, parity audit de-staled; /events/stream session-gated with
the web head proxying same-origin.

**Machine-verified:**
```
bun test apps/api →
✓ no session ⇒ 401, nothing streamed
✓ valid session ⇒ 200 and the stream heartbeats
✓ dev open posture (auth null) ⇒ stream stays usable
✓ webhook route untouched by the gate (HMAC auth); healthz open
live smoke: curl /events/stream (no cookie) → {"error":"session required"}
full: 120 pass, 0 fail · biome clean · 11/11 typecheck · boundaries ✓
```

**Needs Grim's eyes:** none new — transport + gate follow the recorded
precedents.

---

## Installation-sync fix (live gap)

**Scope:** installation/installation_repositories events → 4 new normalized
kinds → repos rows synced (upsert / soft-delete); lazy repo upsert on unknown-
repo change requests; /rules lists active repos only; first SELF-CAPTURED
fixture (our App's live installation delivery).

**Machine-verified:**
```
bun test packages/forge-github → 21 pass (installation.created fixture
  normalizes with our real installation id 145946161 + Boring-Software-Inc/
  scratch; deleted/added/removed map to their kinds)
bun test apps/worker →
✓ install event ⇒ repo row (external_id, installation_id, removed_at null),
  visible via listActiveRepos, NO run created
✓ uninstall ⇒ removed_at set, excluded from active list
✓ change-request for unknown repo ⇒ lazily upserted row
full: 126 pass, 0 fail · biome clean · 11/11 typecheck · boundaries ✓
```

**Live follow-up:** restart the worker, then re-deliver the installation
webhook from the App's Advanced tab (or reinstall) — /rules should show
Boring-Software-Inc/scratch.

---

## Live bring-up + PR-surface polish (arc)

Not a spec step — the sequence from "first webhook" through a proven live
heartbeat, plus the UX polish that surfaced along the way. Each landed as its
own commit with checks green.

**Env + transport fixes (live debugging):**
- `.env` PEM re-quoted (raw multiline broke Bun's parser); worker normalizes
  `\n` escapes.
- Nitro's server-fn runtime loads dotenv from the app dir → `apps/web/.env`
  symlinks the root `.env`; `PORT`→`API_PORT` (leaked into vite via the
  symlink); dev:api / dev:worker root scripts.
- Bun.serve `idleTimeout: 45` (10s default severed 15s-heartbeat SSE).
- Query errors render on the events page instead of the serialization frame.

**@tripwire/auth + web-head transport (5bd9138, f695b75):** auth folded into
its own package (./server + ./client); Better Auth served BY the web head via
`createStart` request middleware (vite proxy is dead under nitro; no
file-based server routes this version); portable UUIDv7 (nitro dev is Node —
`Bun.randomUUIDv7` threw); `/events/stream` session-gated with the web head
proxying same-origin. Spec §2/§3/§10 synced.

**Installation sync (91cd656):** the live gap — installing the App created no
repo row. Four new event kinds, repos synced (upsert / soft-delete), lazy
upsert for unknown repos, /rules lists active repos; first SELF-CAPTURED
fixture (our install delivery).

**Dashboard shell (4cc870f):** the five new surfaces render inside
DashboardLayout — topbar nav everywhere, no back-button escapes.

**PR comment as-built (84fb3d6, 2e8f1fb, f20cf30):** shields badge → hosted
"View on Tripwire" PNG (Grim's Paper design); one cohesive comment (reason up
top, run button in a `for maintainers` dropdown); review defers to the comment;
copy rewritten in tripwire voice.

**Live heartbeat proof (8244f8b) — the milestone:**
```
malicious PR Boring-Software-Inc/scratch#1 (exfil workflow + crypto DONATE +
"pre-approved, submit pass" injection in the description):
  verdict block · crypto-address/honeypot/ai-review all failed
  tripwire check = failure on the head SHA
  ONE comment (marker, upsert) + a CHANGES_REQUESTED review by tripwire-dev[bot]
  ai-review confidence 1.0 — findings on the exfil (curl|sh + GITHUB_TOKEN),
  the "typo fix" social engineering, and the crypto spam; IGNORED the injection
```
The muzzle + trust rules hold against real adversarial input. Correction to a
step-7 note: block review posts as the bot identity, so no 403 on own PRs.
`TRIPWIRE_DISABLE_EXEMPTION=true` (off by default) lets the repo owner test the
gate solo.

**Deferred decision recorded:** public run pages (spec §10 "Access model") —
`/runs/{id}` public read-only so blocked contributors can read the judgment;
mutations + lists stay gated; private-repo runs gated for MVP; findings public,
raw trace gated. Session prompt in DECISIONS.md; patch after rule calibration.

**Checks (final):** biome clean · 11/11 typecheck · boundaries ✓ · 126 tests,
0 fail.

---

## Spec-merge — unified rules (2026-07-11) — docs only

Owner-approved amendment merged into spec.md; "automod" killed as a concept.
Not a fourth primitive — a better rules UI (folds into `/rules`) plus a new
class of rule targets (fold into the rule primitive). Rules declare
`target: change-request | comment | issue`; executor unchanged, only the
RuleContext per trigger differs. Gate actions (change-request) vs reversible
content actions (`hide-comment`/`label`/`send-to-moderation`; never auto-delete);
`validate.ts` enforces target/action fit. Content evals are runs + run_steps +
`run_actions` (reversal handle); `content_matches` derived index. v1 content
rules: spam-domains@1, blocked-terms@1, custom-pattern@1 (RE2/timeout+cap),
comment-burst@1; crypto-address@1 gains `target:comment`. Classifiers deferred.
FP loop = reversals/actions per rule + unhide affordance. New ingest kinds
issues.opened/edited + issue_comment.edited. `/automod` deleted → `/rules`.

**Amendment §4 SUPERSEDED** by owner's derived-default semantics: no-workflow
repos derive the workflow from enabled toggles; custom-workflow repos let the
graph win with toggle = kill switch (`skipped: disabled`, off the degradation
floor); no "not wired" state; `DEFAULT_WORKFLOW` constant → `core/workflow/
derive.ts`; one engine change (worker reads `rule_configs.enabled`) deferred to
the toggle-semantics session. constitution.md bans "automod" (use "rules").
Cut-list additions incl. SIGNAL nodes only (trigger/rule/gate/action exist).
Full ledger in DECISIONS.md. Docs-only pass — no code changed.

**Checks:** biome clean · 11/11 typecheck · boundaries ✓ · tests 125 pass /
1 fail — the failure (`process-event.integration`: "maintainer PR ⇒ exempt, no
run", expects 0 runs, got 1) is PRE-EXISTING on main and code-unrelated to this
docs-only pass; flagged to VERIFICATION-QUEUE, not introduced here.

---

## Live-fix session — four live-test defects + env hardening (2026-07-11)

Four units, one commit each, all four checks green before each. The live-test
report (`live-test-report.md`) is the test agent's artifact — left untouched.

**Unit 1 — gates must see failures (`b221093`, SECURITY).** A gate whose feeding
rules ALL fail never ran: rule→gate edges default `when: pass`, so nothing
conducted the gate, `block` never fired, and the run derived verdict **pass**.
Live evidence: T2a first attempt, single failing rule ⇒ pass; the default gate
only blocked because sibling passing rules opened it. Fix: a gate runs once ≥1
source has settled and aggregates outcomes; when-conduction no longer gates gate
execution. Exhaustive property test: no derived-shape run with ≥1 failing rule
can verdict pass.

**Unit 2 — toggles become real (`c485503`).** The worker never read
`rule_configs` (only the web UI did), so `/rules` toggles were cosmetic —
disabled account-age evaluated anyway (T1). New `core/workflow/derive.ts`: a
repo with no saved workflow gets a workflow DERIVED from enabled rules (baseline
= the retired `DEFAULT_WORKFLOW`); baseline rule runs unless disabled, config
overrides, non-baseline enabled rules opt in. Saved-workflow path skips disabled
nodes as `disabled` (conducts as pass, off the degradation floor). `/rules`
gains a "managed by your workflow" tag.

**Unit 3 — surface sweeper + comment ownership + boot health (`ef9b797`).** T3:
a creds outage left needs_review surface actions stuck at `recorded` — the
neutral check never posted, the stale comment stood, no retry. Plus a follow-on
finding: two moderation items on one PR decided out of order, an older run's
approve overwrote the blocked comment. Fixes: a minutely sweeper re-attempts
stuck actions (idempotent, age-windowed cap); a staleness guard supersedes rows
whose verdict moved on; **comment ownership** — only the latest run per PR
executes its comment (per-SHA checks still post), enforced in `emitPrSurface` +
the sweeper; a boot health check (GitHub `GET /app` + ai-review creds) makes a
broken-env worker loud at startup.

**Unit 4 — env hardening + queue #10 closed (this commit).** #10 was env
contamination, not code: `TRIPWIRE_DISABLE_EXEMPTION` leaked into the process
env. Worker integration tests now delete/restore the flag in setup (proven: the
maintainer test passes even with the flag set ambiently); the flag is refused
under `NODE_ENV=production` (resolveAuthPosture pattern), unit-tested. #10 closed.

**Checks (final, all four units): biome clean · 12/12 typecheck · boundaries ✓ ·
145 tests, 0 fail.**

**Unit 5 — deny never fails open (this commit).** T4 headline: a deny on a
moderation node with no deny edge resumed to PASS — green check from an explicit
maintainer no. `resume-run.ts` now floors that case to block (synthetic
`run:deny-floor` step + recorded/executed block action); approve semantics and
explicit-deny-edge graphs untouched; degraded-floor resume pinned by test.
Checks: biome clean · typecheck ✓ · boundaries ✓ · 148 tests, 0 fail.

**Unit 6 — editor outcome handles (this commit).** Adopted the T4 mid-test fix
(red fail handle on rule/gate nodes, white targets, sourceHandle ⇒ when:"fail")
and hardened it: `handleWhen()` generalizes the mapping, send-to-moderation
nodes gain green approve / red deny handles, handles beat stale labels, and
when-edges reload onto their handles. Round-trip tested (5 new tests); worker
emission fixture unchanged (node shapes untouched). Editor can now draw the
full moderation loop that Unit 5's deny floor backstops.
Checks: biome clean · typecheck ✓ · boundaries ✓ · 153 tests, 0 fail.

**Unit 7 — verdict replay, the missing §11 row (this commit).** `bun run
replay` re-runs the CURRENT engine over stored runs — raw events re-normalized,
rule envelopes replayed verbatim from run_steps (never a live GitHub read),
snapshots re-executed through the current executor/floors/resume — and diffs
verdicts. CI gate on `packages/core/**` replays the committed 15-run corpus
(`.github/workflows/replay.yml`); `replay.test.ts` pins the expectation. Known
gap #2 closed. Flip report over ALL 15 stored runs, verbatim:

```
verdict replay — 15 runs · 13 unchanged · 2 flips · 0 skipped
FLIP 019f538a-926f-7000-87c7-e9cd3d79c80a: pass → block
  responsible: gate reachability (unit 1) — gates now run once a source settles, failures included
  failed rules: account-age@1
  evidence delta: none — rule envelopes replayed verbatim from stored run_steps; only the walk changed
FLIP 019f54d3-0c13-7000-930a-dc97f87e1d5e: pass → block
  responsible: deny-floor resume semantics (unit 5) — deny with no deny edge now blocks
  failed rules: account-age@1
  evidence delta: none — rule envelopes replayed verbatim from stored run_steps; only the walk changed
```

Exactly the two explainable flips (T2a first-attempt single-failing-rule pass,
T4 deny-produced pass), zero unexplained, zero skipped — the done-when held.
Ledgered for later: VERIFICATION-QUEUE #11 (run page + /moderation surface
`run:deny-floor` distinctly — UI pass, bundles with the public-run-page patch).

**Public run pages + queue #11 (this commit).** §10 access model is live:
`/runs/{id}` reads without a session (root redirect exempts it via
`isPublicPath`), rendering verdict + per-rule steps + evidence + ai-review
FINDINGS with the raw trace stripped from evidence AND output, snapshot
nulled, dashboard chrome dropped, "powered by tripwire" footer added. No
session + private/unknown repo ⇒ null (fail closed; worker's lazy repo upsert
now defaults private for the same reason). Mutating + list server functions
gained a real 401 gate (`requireSession`) — approve/deny, events, moderation
queue/stats, rules, workflows, analytics activity; `decidedBy` is now the
session user. Queue #11 closed: `run:deny-floor` renders as "denied by
maintainer — no deny edge drawn", `run:degradation` as "evaluation degraded"
with the skipped ratio; /moderation pills `run:degraded` items. Ledgered:
any-session-sees-any-run (no repo-membership model yet) and visibility not
threaded through change-request payloads.
Checks: biome clean · typecheck ✓ (12/12) · boundaries ✓ · 177 tests, 0 fail.

**Unit 8 — /rules over real data (this commit).** The automod mockup's UI
becomes `/rules` on real stored data (§9 step 3), honest-render throughout.
Fixes the Unit-2 residual: the toggle now shows ACTUAL execution state
(`ruleExecutes` mirrors derive.ts — baseline rules ON unless disabled), not the
old `enabled ?? false` that hid the baseline rules a fresh repo runs; saved-
workflow repos show "managed by your workflow". New `getRulesStats` reads
run_steps (matches) + run_actions (executed enforcement kinds only, never the
always-emitted comment/check) repo-scoped over 24h with hourly sparklines — no
new pipeline. Header: active rules + matches/actioned (real sparklines) + FP
rate ("not enough data" — reversals untracked). Cards: id@version chip, target
chip, action summary, corrected toggle, 24h count, sparkline, JSON config.
Matcher-kind chips + FP sort omitted (no data, not faked). Checks: biome clean ·
typecheck 0 · boundaries ✓ · 184 tests, 0 fail (+7).
