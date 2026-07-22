# Tripwire — Unit Economics: cost per run, per review, per org, pricing inputs

_Retrieval date for all external pricing: **2026-07-20**. Measured data is labeled
**measured** (prod DB aggregates, eval scorecards). Modeled data is labeled
**modeled** and shows its arithmetic. This report corrects the earlier
`infra-cost-audit.md`, which priced AI review on Claude Fable 5 at $10/$50.
Prod ships `x-ai/grok-4.5` at **$2 in / $6 out / $0.30 cached** per 1M tokens.
That is a 20 to 25x cheaper reality, and it changes the pricing conversation._

---

## 1. Executive summary — the three founder questions

1. **What does Tripwire cost to run?** Fixed floor is ~$20/mo today, ~$45–65/mo
   after the Vercel comp lapses and Railway goes Pro. Marginal cost per unit is
   near zero for everything except AI review: a deterministic run costs
   fractions of a thousandth of a cent, an ingested event even less.
2. **What does the agentic layer cost?** One AI review costs **$0.0089
   measured** (42 eval runs, grok-4.5, real spend $0.37). Call it one cent.
   A busy org doing 300 reviewed PRs/mo costs **~$2.70/mo** in model spend.
   At competitor-style pricing ($10–48/seat/mo) the gross margin on AI review
   is above 95%.
3. **Can the base firewall be free?** Yes. Marginal cost per AI-off org is
   ~$0.01/mo storage-and-compute. The free tier's real costs are the fixed
   floor and two step-cliffs (SSE connection ceiling, Databuddy event cap),
   not per-org spend. Thousands of free orgs fit under $100/mo.

The one number to carry into pricing: **a review costs about a cent. Every
competitor charges per seat, $10–48/mo. The margin question is not whether AI
review is profitable. It is how much of that gap you claim vs use as a wedge.**

---

## 2. Per-unit cost table

| Unit | Cost | Basis |
|---|---|---|
| One deterministic run (webhook → rules → writes → delivery) | **~$0.000005** marginal | modeled, bounded; arithmetic in A.1 |
| One AI review (grok-4.5, current avg PR) | **$0.0089** | **measured** (scorecard spend $0.3719 / 42 runs) |
| One AI review, large diff (50k in / 2k out) | ~$0.11 | modeled at $2/$6 |
| One AI review re-run (admin triggered) | same $0.0089 | same path, no discount |
| One event ingested (non-run webhook) | **~$0.0000006** | modeled from measured row size (2.4 KB) |
| One SSE viewer-hour | $0 until the connection ceiling; ~$0.00007 amortized past it | modeled; step function, A.4 |
| One agentic interaction (future MCP/chat surface) | `$2e-6 × tokens_in + $6e-6 × tokens_out`; e.g. 10k/1k = **$0.026** | forward-looking placeholder; no such surface exists in v2 today |

Measured inputs behind the table (prod DB, 2026-07-20, aggregate-only queries
listed in A.5): 864 runs, 6,249 steps (7.2/run), 2,090 actions (2.4/run),
1,241 events. Average row bytes: run 1,553, step 455, action 208, event 2,396.
One full run persists **~5.3 KB**; with its triggering event, **~7.7 KB**.
Whole prod DB after the beta period: **26 MB**. Current rates: ~71 events/day,
~17 runs/day (7-day window).

The scorecard measured **~3,000–3,200 total tokens and 1.3 steps per review**.
The one prod trace inspected (scratch#64) burned 3,669 in / 235 out ≈ $0.0088,
consistent with the eval number. Eval fixtures skew small; treat $0.006–0.015
as the typical band and $0.11 as the large-diff tail.

Caching: xAI caching is automatic upstream (no cache-write charge; reads at
$0.30/1M vs $2). The scorecard could not measure the hit rate. Best case
(60% of input cached) takes a review from $0.0089 to **~$0.0062**. Real but
not transformative at these token sizes.

---

## 3. Org-month archetypes

Marginal cost only. The fixed floor ($45–65/mo post-comp) is shared, not
per-org; at 100 active orgs it amortizes to ~$0.50/org, at 1,000 orgs ~$0.05.

| Archetype | Volume | AI off | AI on |
|---|---|---|---|
| Quiet personal org | ~5 PRs, ~20 events/mo | **<$0.01/mo** | **~$0.05/mo** |
| Small team | ~30 PRs, ~150 events/mo | **<$0.01/mo** | **~$0.27/mo** |
| Busy monorepo | ~300 PRs, ~1,500 events/mo | **~$0.02/mo** | **~$2.70/mo** (large-diff-heavy: ~$9) |

The abuse case for "free with unlimited AI": the busiest plausible single org
(a 100-contributor monorepo at ~2,000 reviewed PRs/mo) costs **~$18/mo**. A
hostile PR-spammer is bounded by GitHub's 5,000 req/hr per-installation rate
limit and by the per-review step cap; a sustained 10,000 reviews/mo attack
costs **~$89/mo** before any throttle you add. Uncomfortable, not fatal.
A soft cap (e.g. reviews/mo per free org) removes the tail entirely.

---

## 4. Margin structures (inputs, not decisions)

Three shapes Dan's question implies. COGS per review = $0.009 (current),
$0.045 (5x provider-risk case).

**A. Flat per-org (or per-seat) price.**
- Break-even against AI COGS: a flat $5/org covers any org up to ~550
  reviews/mo. A flat $10 covers ~1,100.
- Worst-case money-loser: the 2,000-review monorepo on a $5 flat plan costs
  $18, loses $13/mo. Rare profile, real exposure, unbounded above.
- Property: simplest to sell; margin erodes exactly on your best users.

**B. Metered AI (base free, pay per review).**
- At $0.05/review: 82% gross margin now, 10% at the 5x-price case.
- At $0.10/review: 91% now, 55% at 5x.
- The busy monorepo pays $15–30/mo, proportional to use. Nobody loses money.
- Property: perfectly safe, but per-unit pricing on a cent-cost good invites
  competitors to give it away. Every named competitor bundles reviews into
  seats; nobody meters per review except Greptile (credits) and Ellipsis
  (raw tokens + 100% fee).

**C. Hybrid (flat base + included review quota + metered overage).**
- Example shape, not a recommendation: free = firewall + N reviews/mo;
  paid flat = generous quota; overage metered.
- Break-even: a flat $10 tier with a 500-review quota has worst-case COGS
  $4.50 (full quota burn), floor-share ~$0.50, margin ≥50% on the worst
  case and ~95% typical.
- Property: caps the tail from structure A, keeps the simplicity story,
  the quota is the abuse valve.

Cost floor per tier candidate:
- **Free, AI off**: ~$0.01/org/mo marginal. Sustainable indefinitely; the
  cliffs are shared (SSE connections, Databuddy events), not per-org.
- **Free with AI**: $0.05–2.70/org/mo depending on volume. Defensible with a
  quota; indefensible unlimited only against the monorepo tail.
- **Paid**: any price ≥$5/org clears every plausible profile's COGS today.

---

## 5. Sensitivity

| Scenario | Review cost | Busy-org month (300) | Notes |
|---|---|---|---|
| Today (grok-4.5 $2/$6) | $0.0089 | $2.70 | measured |
| Model price 5x (single-vendor risk) | $0.045 | $13.35 | wipes free-with-AI; metered/hybrid margins survive |
| Avg PR tokens 2x | ~$0.018 | $5.40 | linear in tokens |
| Caching lands at 60% input hit | ~$0.0062 | $1.85 | reads $0.30/1M vs $2; automatic on xAI, hit rate unmeasured |
| Fallback to Haiku 4.5 ($1/$5) | ~$0.0072 | $2.15 | measured $0.302/42; second-vendor hedge exists today |

Provider risk is the only sensitivity that moves the pricing decision. The
hedge is already wired: `AI_REVIEW_MODEL` is env + per-rule config, and the
Haiku scorecard proves a same-day fallback at comparable cost.

---

## 6. Competitive anchor (market context only)

| Product | Model | Price | Free tier | Source (2026-07-20) |
|---|---|---|---|---|
| CodeRabbit | per seat | Pro $24/user/mo, Pro Plus $48 (annual) | summaries + IDE reviews, unlimited repos | coderabbit.ai/pricing |
| Greptile | per seat + credits | $30/seat/mo incl. 50 credits (1 review = 1 credit; extra $1) | 50 credits/mo, 1 dev | greptile.com/pricing |
| GitHub Copilot code review | bundled per seat | in Copilot Pro $10 / Pro+ $39 / Max $100 | not in Copilot Free | github.com/features/copilot/plans |
| Graphite AI Reviews | per seat | Starter $20/user/mo (limited), Team $40 (unlimited, annual) | hobby: personal repos, limited | graphite.com/pricing |
| Ellipsis | usage | tokens at model rates + 100% fee; ≈$0.74/review | $100 credit ≈ 135 reviews | ellipsis.dev/pricing |

Read: the market prices per seat at $10–48/mo while the underlying review
costs cents. Ellipsis is the outlier proving a metered model exists at ~$0.74
per review, 80x Tripwire's current COGS.

---

## 7. Open measurements

1. **Worker vCPU-seconds per run.** Not instrumented. Bounded in A.1; the
   bound would have to be wrong by 1,000x to matter. Instrument if a metered
   compute price is ever contemplated.
2. **Cache hit rate on grok-4.5.** Scorecard reports "not measurable" through
   OpenRouter's usage block today. Worth one instrumented week before
   assuming the $0.0062 case.
3. **PlanetScale connection ceiling on PS-5.** Not published. The SSE design
   holds one direct connection per live dashboard viewer; find the real
   ceiling empirically before any launch spike (or multiplex LISTEN first).
4. **Real distribution of PR token sizes in prod.** Eval fixtures skew small.
   The trace store has the data; a week of prod traces gives the true band.
5. **Prod token spend telemetry.** Traces persist tokens per run; nothing
   aggregates them into $/org/mo yet. That table is the metering feature.

---

## Appendix A — Arithmetic

**A.1 Deterministic run, marginal.**
Compute: Railway vCPU = $20/vCPU-month = $20 / 2,592,000 s = $7.7e-6 per
vCPU-second. A rules pass is pure JS over an in-memory context; octokit time
is I/O wait, not CPU. Upper bound 0.5 vCPU-s per run ⇒ **≤$0.0000039**.
Storage: 5.3 KB/run. Inside PlanetScale's included 10 GB: $0. Past it at
$0.125/GB-mo: 5.3e-6 GB × $0.125 = **$0.00000066 per run-month retained**.
Amortized view (today's whole floor / today's volume): $20 / 510 runs ≈
$0.04/run. That number is the fixed floor divided by tiny volume, not a
marginal cost; it falls toward the marginal figure as volume grows.

**A.2 AI review.**
Measured: $0.3719 total OpenRouter spend / 42 runs = **$0.00885**. Tokens:
135,498 / 42 = 3,226 avg total. Cross-check at list price: 2,600 in × $2e-6
+ 600 out × $6e-6 = $0.0052 + $0.0036 = $0.0088. Matches.
Large diff: 50,000 × $2e-6 + 2,000 × $6e-6 = $0.10 + $0.012 = **$0.112**.
Cached case: 60% of input at $0.30: (0.4 × 2,600 × $2e-6) + (0.6 × 2,600 ×
$0.3e-6) + $0.0036 = $0.0021 + $0.0005 + $0.0036 = **$0.0062**.
Haiku 4.5 measured: $0.302 / 42 = **$0.0072** at 4,936 avg tokens.

**A.3 Event ingested.**
2,396 B row + one indexed insert + one normalize job. Storage past free tier:
2.4e-6 GB × $0.125 = $0.0000003/mo. CPU bound ≤0.1 vCPU-s = $0.0000008.

**A.4 SSE viewer-hour.**
Each viewer = one dedicated direct Postgres connection (`stream.ts` LISTEN;
pooled connections cannot LISTEN). Marginal cost is $0 until the node's
connection ceiling forces PS-5 ($5) → PS-10 ($10). If 100 concurrent viewers
force that step: $5 / (100 × 730 h) = **$0.00007 per viewer-hour**. The unit
is a step, not a slope; the mitigation (multiplexing LISTEN across viewers)
removes it entirely.

**A.5 Queries run (prod, read-only, aggregates only, 2026-07-20).**
```
select count(*), avg(pg_column_size(t.*)) from {events|runs|run_steps|run_actions} t;
select avg(c) from (select count(*) c from run_steps group by run_id) s;
select count(*)/7.0 from events where received_at > now() - interval '7 days';
select count(*)/7.0 from runs   where created_at  > now() - interval '7 days';
select pg_database_size(current_database());
select relname, pg_total_relation_size(relid) from pg_statio_user_tables order by 2 desc limit 6;
```
No user-identifying rows were read.

**A.6 Org archetype math.**
Quiet: 5 × $0.0089 = $0.045. Small team: 30 × $0.0089 = $0.267.
Busy: 300 × $0.0089 = $2.67; large-diff-heavy at $0.03 avg: 300 × $0.03 = $9.
Abuse: 2,000 × $0.0089 = $17.80; 10,000 × $0.0089 = $89.

## Appendix B — Sources (retrieved 2026-07-20)

- OpenRouter models API — openrouter.ai/api/v1/models: grok-4.5 $2/$6, cached
  read $0.30 (long-context >200k: $4/$12/$0.60); haiku-4.5 $1/$5 (cache read
  $0.10); sonnet-4.6 $3/$15. Card fee 5.5% ($0.80 min) — openrouter.ai/docs/faq.
- Railway — railway.com/pricing, docs.railway.com/reference/pricing/plans:
  Hobby $5 + $5 usage; Pro $20/seat + $20; vCPU $20/mo; RAM $10/GB-mo;
  egress $0.05/GB.
- PlanetScale Postgres — planetscale.com/pricing + docs: PS-5 $5 ($15 HA),
  PS-10 $10 arm64, PS-80 $49 arm64; 10 GB included, then $0.125/GB-mo
  (us-east-1); connection limits unpublished.
- Vercel — vercel.com/pricing: Pro $20/user/mo + usage.
- Competitors — coderabbit.ai/pricing, greptile.com/pricing,
  github.com/features/copilot/plans, graphite.com/pricing,
  ellipsis.dev/pricing (details in §6).
- Internal — scripts/eval/scorecards/2026-07-17T09-12-26-582Z_grok-4.5.json
  (42 runs, $0.3719, 135,498 tokens, 1.3 avg steps);
  2026-07-17T08-28-36-930Z_claude-haiku-4.5.json (42 runs, $0.302);
  prod DB aggregates per A.5; docs/infra-cost-audit.md (2026-07-16) for the
  fixed-floor and cliff analysis, corrected here on review-model pricing.
