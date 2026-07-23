# Tripwire Unit Economics

As of 2026-07-22. Trailing 30-day window. Prod deployment.

Reproduce with `bun --env-file=.env.production run scripts/economics.ts`. The
script is read-only. It runs SELECT-only queries for the live denominators and
holds every external billing number as a named constant. Every figure in this
report traces to an external input, a cited query result, or a named assumption
in the table at the end. No unlabeled estimates.

## Headline

At current volume Tripwire is a fixed-cost business. The marginal cost of a run
is a fraction of a cent. The whole cost is the $50/mo accrued floor (Railway $5
plus PlanetScale $45), or $5/mo in cash while the $1000 PlanetScale credit lasts.

Three findings drove the model and correct the starting brief.

1. The 477 OpenRouter requests are not production traffic. Production persisted
   only 7 real AI reviews in the window. The eval harness and dev testing on the
   same API key produced the rest. See "The 477 reconciliation" below.
2. Measured marginal AI cost per reviewed run is $0.0033, not the $0.01
   placeholder. Output reasoning tokens dominate that cost.
3. Prompt caching is a red herring at this scale. The prompt is already
   structured cache-first. The low observed cache rate is a traffic-density
   artifact, and even perfect caching saves 13% of a third of a cent.

## Denominators (live query, 2026-07-22)

| Metric | Value | Source |
|---|---|---|
| Runs (30d) | 276 | Q1: 273 completed, 2 paused, 1 failed |
| Run steps (30d) | 1,895 | Q2 |
| Events (30d) | 1,231 | Q6 |
| Active orgs (30d) | 2 | Q4 |
| Active repos (30d) | 3 | Q5 |
| Real AI-reviewed runs (30d) | 7 | Q8 / TOK, persisted OpenRouter traces |
| AI input tokens (30d) | 14,327 | TOK |
| AI output tokens (30d) | 2,388 | TOK |
| AI cache-read tokens (30d) | 128 | TOK, 0.9% of input |
| Runs (all-time) | 877 | D1, matches the supplied counter |
| Steps (all-time) | 6,331 | D1 |
| Events (all-time) | 1,832 | D1 |

The all-time counts match the supplied product counters exactly. The 30-day
window is where the model lives.

## The 477 reconciliation

The brief listed 477 OpenRouter requests and 877 runs and asked to resolve the
mismatch. The database resolves it.

- Only 7 runs in the window carry a real OpenRouter usage trace (query TOK).
  56 run steps all-time reference `ai-review@1` or `ai-review@2`, but 49 of
  those are seed rows whose trace is `{ findings: N }`, not a model call
  (`packages/db/src/seed.ts`). Only 7 steps carry a real usage object.
- The eval harness calls the live model on the same key. It is not gated to
  prod: `scripts/eval/run.ts:27-30` reads `OPENROUTER_API_KEY` and warns
  "Evals call the live model." It runs `FIXTURES.length x RUNS_PER_FIXTURE`
  per invocation (`run.ts:139`) and tracks cost and tokens per run
  (`run.ts:193-210`).
- So the $4.73 OpenRouter spend and the 477 requests are dominated by eval and
  dev traffic. They are not customer-run cost. Dividing $4.73 by production
  reviews would overstate per-review cost by roughly 70 times.

Consequence for pricing: marginal AI cost is measured bottom-up from the 7
persisted production traces, priced at Grok list. It is not `spend / runs`.

## Unit costs

Fixed cost, accrued: $50.00/mo. Railway floor $5 plus PlanetScale $45.
Fixed cost, cash: $5.00/mo. PlanetScale runs on the $1000 credit, so $0 cash.

Marginal cost:

| Unit | Cost | Basis |
|---|---|---|
| AI per reviewed run (measured, Grok) | $0.0033 | 2,047 input + 341 output tokens/req at $0.557/M and $6.49/M |
| AI per reviewed run (blended cross-check) | $0.0046 | same persisted tokens at OpenRouter blended $1.92/M |
| Railway per run (worker+api CPU+egress) | $0.0013 | $0.3553 MTD marginal / 276 runs, assumption A1/A2 |
| Marginal per reviewed run (AI + Railway) | $0.0046 | sum of the two |

The two AI numbers bracket the truth. Bottom-up Grok pricing gives $0.0033. The
OpenRouter blended rate on the same tokens gives $0.0046. The blended rate
over-weights output, so the real figure sits near the low end.

Fully loaded unit cost, fixed spread over current volume:

| Unit | Accrued | Cash |
|---|---|---|
| Per run | $0.1812 | $0.0181 |
| Per run step | $0.0264 | n/a |
| Per active org | $25.00 | $2.50 |
| Per active repo | $16.67 | n/a |

These fully loaded numbers are large only because the fixed floor is divided by
tiny volume. They fall fast with scale. The marginal numbers are the ones that
matter for pricing.

## Projections

Runs scale 1x, 5x, 25x, 100x off the current 276/mo. AI-reviewed share is held
at 2.5% (assumption A7). Railway RAM and the web service are treated as a fixed
baseline. Worker and api CPU and egress scale with runs (assumption A1/A2).

| Scenario | Runs/mo | Railway usage | Railway billed | AI/mo | Accrued/mo | 6mo accrued |
|---|---|---|---|---|---|---|
| 1x | 276 | $1.35 | $5.00 | $0.02 | $50.02 | $300.14 |
| 5x | 1,380 | $2.77 | $5.00 | $0.12 | $50.12 | $300.70 |
| 25x | 6,900 | $9.88 | $9.88 | $0.59 | $55.46 | $332.77 |
| 100x | 27,600 | $36.52 | $36.52 | $2.34 | $83.87 | $503.20 |

Railway crosses the $5 included floor at 11.3x, about 3,112 runs/mo. Below that
the Railway bill is flat at $5. Above it you pay actual usage.

Even at 100x the monthly accrued cost is $83.87. AI is $2.34 of that. The cost
of this product does not come from usage. It comes from the fixed database tier.

## Fixed-cost tier breaks

PlanetScale storage grows about 16,085 bytes per run (runs, steps, actions, and
the ~2 events per run). Query Q9 confirms `events` and `run_steps` are the
largest app tables. The append-only event store is the main growth driver, as
expected, because raw payloads are never deleted.

- Storage: 553 MB of 10 GB used today. The 10 GB cap is reached after about
  631,000 more runs. At 100x sustained that is about 23 months. Not a near-term
  constraint.
- Egress: 1.02 GB of 100 GB included. Not a constraint at any modeled scale.

Credit exhaustion: $1000 / $45 = 22.2 months at the current PlanetScale tier. No
modeled scenario forces a PlanetScale tier change inside 6 months, so the credit
burn rate holds across all scenarios. A tier change (bigger PS cluster) is what
would pull the exhaustion date forward, and nothing in the 6-month horizon
triggers one. The `job_common` pg-boss table (9.2 MB) is the single largest
table today, but it is transient queue state, not monotonic growth.

## Cache sensitivity

Only the static instructions prefix is cacheable. It is assembled before the
dynamic diff: `apps/worker/src/ai/generate.ts:41` passes the versioned
instructions as `system`, and `packages/core/src/rules/ai-review/rule.ts:35-60`
renders the diff and PR metadata into the `prompt`. That is already the
cache-first order a provider wants.

The cacheable fraction is the prefix over average input. `instructions-v2.md` is
4,165 chars, about 1,041 tokens (assumption A3a, 4 chars per token). Average
input in the persisted sample is 2,047 tokens. So 51% is cacheable on these
small test PRs. A real PR with a 60,000-char diff (the clip budget at
`rule.ts:22`) is about 15,000 input tokens, which drops the cacheable fraction
to about 7%.

The provider-typical 89% cache rate is not reachable here. It exceeds the
cacheable cap. 89% assumes most of the prompt is a stable reused prefix. Tripwire
sends a fresh diff every review, so the stable prefix is a minority of the
tokens.

Cost per review at cache hit rates, capped at the cacheable fraction:

| Cache hit | Cost per review |
|---|---|
| 0% | $0.0034 |
| 26.4% | $0.0031 |
| 60% (capped to prefix) | $0.0029 |
| 51% best case, full prefix cached | $0.0029 |

Best-case saving versus zero cache is $0.0004 per review, about 13%. At 100x
volume that is roughly $0.30/mo. It is immaterial.

Two plain conclusions. First, output reasoning tokens dominate the bill. The
sample review spent 1,006 reasoning tokens, and output is billed at $6.49/M
against input at $0.557/M. Output is not cacheable. The real cost lever is the
reasoning-token budget, not the cache. Second, the observed 26.4% rate is low
because traffic is sparse, not because the prompt is badly structured. At about
16 requests a day the provider cache is cold between calls. In the persisted
prod sample only 128 of 1,041 prefix tokens were served from cache. Restructuring
the prompt changes nothing. Higher request density, or an explicit longer-lived
cache directive, is the only thing that would move the rate.

## Pricing scaffolding

Motion reference: Dependabot and Snyk. Free for open-source repos, paid for
commercial orgs.

Marginal cost per reviewed run is the measured $0.0046 (AI plus apportioned
Railway). A $0.01 ceiling is carried as a sensitivity bound for orgs that review
large-diff PRs, where input tokens run higher.

Free-org monthly subsidy by allowance:

| Allowance | Measured subsidy | Ceiling subsidy |
|---|---|---|
| 25 runs/mo | $0.116 | $0.25 |
| 50 runs/mo | $0.232 | $0.50 |
| 100 runs/mo | $0.463 | $1.00 |

Free orgs one paid org carries, subsidy only, fixed cost excluded:

| Allowance | $19 | $29 | $49 |
|---|---|---|---|
| 25 runs/mo | 164 | 250 | 422 |
| 50 runs/mo | 82 | 125 | 211 |
| 100 runs/mo | 41 | 62 | 105 |

The binding constraint at current scale is the fixed floor, not the free-org
subsidy. It takes 3 paid orgs at $19, or 2 at $29 or $49, just to cover the
$50/mo accrued floor. Once the floor is covered, a single paid org subsidizes
dozens to hundreds of free orgs, because free-org marginal cost is a fraction of
a cent per run. Price to clear the fixed floor first. The free tier is cheap.

Before any of this bills real customers, build the usage-capture table so per-org
metering exists. See the next section.

## Pre-pricing build item: ai_review_usage

Token metering is not usable today. Token counts land inside `run_steps.evidence`
jsonb as part of the trace (`generate.ts:85-96`, `rule.ts:101`,
`packages/db/src/services/runs.ts:192-195`), but there is no dollar cost, no org
key, and the trace shape is inconsistent (seed rows carry `{ findings }`, real
rows carry a raw AI SDK usage object). Metering by digging through jsonb is not
viable.

Proposed table, one row per `generate()` call, written by the worker after the
ai-review step persists. Read-only constraint still applies here, this is a
design sketch only.

```
ai_review_usage
  id              text primary key
  run_step_id     text references run_steps(id)   -- the metering grain
  run_id          text references runs(id)         -- one hop for run rollups
  org_id          text                              -- denormalized from repos, the credit key
  model           text
  http_requests   int                               -- from trace stepsUsed
  prompt_tokens   int
  completion_tokens int
  cached_tokens   int
  cost_usd        numeric                           -- captured per request, see note
  created_at      timestamptz default now()
  index (org_id, created_at)
  index (run_id)
```

Build notes.

- Capture dollar cost with OpenRouter's `usage.include`. Set the provider option
  so the completion response returns the billed cost, then persist `cost_usd`
  per request. The AI SDK does not surface cost today, which is why cost is
  absent from the current trace.
- Denormalize `org_id` at write time from the repo. Runs reach an org only
  through `repos.full_name` then `repos.org_id`, and `org_id` can be null. Write
  it onto the row so metering is one lookup.
- Keep the existing bounded trace in evidence for the run page. This table is for
  metering, not display.

## Honesty ledger and assumptions

Every assumption is labeled. The projections and pricing depend on these.

| ID | Assumption |
|---|---|
| A1 | Worker and api CPU and egress scale with run volume. Their MTD sum ($0.3553) divided by 276 runs is the marginal Railway cost per run. |
| A2 | Railway RAM and the entire web service are a fixed baseline, not run-attributable. Web serves the dashboard, not runs. |
| A3a | Token estimate for the instructions prefix uses 4 chars per token on the 4,165-char `instructions-v2.md`, about 1,041 tokens. |
| A3b | Cache-read tokens are billed at 25% of input list price. The provided inputs did not give a cache-read rate, so the common provider convention is used. |
| A4 | One reviewed run maps to the OpenRouter requests recorded in its trace. Reconciled by query TOK, which found 7 requests across 7 runs. |
| A5 | Marginal cost scales linearly with run volume. Fixed costs step, they do not scale. |
| A6 | PlanetScale storage growth is dominated by runs, steps, actions, and the append-only event store. Confirmed by query Q9. |
| A7 | The AI-reviewed share of runs holds at the current 2.5% across scenarios. This is low because ai-review is barely wired into production workflows today. If adoption rises, AI cost rises proportionally, and at $0.0033/review it stays small. |

Data provenance.

- External billing numbers (Railway, OpenRouter, Grok pricing, PlanetScale tier
  and credits) are operator-supplied ground truth, encoded as constants in
  `scripts/economics.ts`.
- Denominators and token counts come from SELECT-only queries run against prod on
  2026-07-22. The script re-runs them live on each invocation.
- Prod `AI_REVIEW_MODEL` is Grok 4.5, confirmed by the operator. The repo code
  default is `anthropic/claude-fable-5` (`apps/worker/src/index.ts:109-110`); the
  env overrides it in prod.

Open gaps.

- Dollar cost per AI request is still not persisted. The `ai_review_usage` build
  closes this.
- The observed cache-read fraction in prod is 0.9%, measured from 7 requests.
  That is a small sample. It agrees with the sparse-traffic explanation but is
  not a large dataset.
- Worker idle versus active compute is an apportionment, not a measurement. Two
  per-minute cron jobs (`sweep-actions`, `deliver-webhook`) run forever, so some
  worker compute is idle polling. A1 assigns only CPU and egress to runs, which
  keeps the run-attributable share conservative.

## Query appendix

All queries are SELECT-only. Run window is `now() - interval '30 days'`.

```sql
-- Q1 runs in window by status
SELECT status, count(*)::int AS runs FROM runs
WHERE created_at >= now() - interval '30 days' GROUP BY status;

-- Q2 run steps in window
SELECT count(*)::int FROM run_steps s JOIN runs r ON s.run_id = r.id
WHERE r.created_at >= now() - interval '30 days';

-- Q4 active orgs (repo_full_name -> repos.org_id)
SELECT count(DISTINCT rp.org_id)::int FROM runs r
JOIN repos rp ON rp.full_name = r.repo_full_name
WHERE r.created_at >= now() - interval '30 days' AND rp.org_id IS NOT NULL;

-- Q5 active repos
SELECT count(DISTINCT repo_full_name)::int FROM runs r
WHERE created_at >= now() - interval '30 days';

-- Q6 events in window
SELECT count(*)::int FROM events WHERE received_at >= now() - interval '30 days';

-- TOK real AI-review tokens, shape-robust (bounded and raw traces), window
WITH t AS (
  SELECT s.run_id, s.evidence->'evidence'->'trace' AS tr
  FROM run_steps s JOIN runs r ON s.run_id = r.id
  WHERE r.created_at >= now() - interval '30 days'
    AND s.rule_id LIKE 'ai-review@%'
    AND ((s.evidence->'evidence'->'trace') ? 'usage'))
SELECT count(*)::int AS requests, count(DISTINCT run_id)::int AS runs,
  sum(COALESCE((tr->'usage'->>'input')::bigint,(tr->'usage'->>'inputTokens')::bigint))  AS input,
  sum(COALESCE((tr->'usage'->>'output')::bigint,(tr->'usage'->>'outputTokens')::bigint)) AS output,
  sum(COALESCE((tr->'usage'->>'cached')::bigint,
               (tr->'usage'->'inputTokenDetails'->>'cacheReadTokens')::bigint)) AS cache_read
FROM t;

-- Q9 per-table storage
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
```
