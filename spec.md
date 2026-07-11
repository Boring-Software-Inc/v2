# TRIPWIRE — Greenfield Scaffold Spec

> This document is the source of truth for the Tripwire rebuild. Every agent session
> starts here. If code in the repo contradicts this spec, the spec wins until Grim
> amends it. Nothing in the cut list gets built. No exceptions "while we're in here."

---

## 1. What Tripwire is

Tripwire is a contribution gatekeeper for git forges. It ingests forge webhooks,
evaluates contributors and change requests against composable **rules** orchestrated
by **workflows**, produces auditable **runs**, and acts on the forge (block, label,
comment, request review, send to moderation).

**Mental model — git as the VM:** git itself (commits, refs, diffs, authorship) is
universal. Everything else — stars, sponsors, profile READMEs, achievements, MR
approvals — is a **social layer each platform builds on top**. Tripwire's core speaks
only the universal layer plus an abstract signal vocabulary. Platform packages
translate their social layer into that vocabulary.

**MVP scope: GitHub, balls to the wall.** Full GitHub support first — review bot,
event ingesting, moderation queue, live event lists, rule workflows. Agnosticism is
*not deferred as a boundary*, only as an implementation: the seams (neutral types,
`ForgeAdapter`, signal taxonomy) exist from day 1; the second adapter does not.

### The three assets being ported (not merged)

| Asset | What we take | What we discard |
|---|---|---|
| **Redesign demo** | The UI wholesale + its mock data shapes (they become `contracts`) | Nothing — design is final |
| **eve bot demo** (`~/tripwire-eve-demo`) | Review process: instructions, review format, tool flow | The eve runtime entirely |
| **Old prod repo** | Inspiration only: rule logic, GitHub API quirks, webhook lessons | The codebase. Never copy files from it. It contains the scope creep. |

### Today's goal

**Everything working locally.** Deployment is later; the stack is vendor-neutral so
hosting is a non-decision for now (docker-compose Postgres locally, PlanetScale
Postgres when deployed, compute anywhere that runs Bun).

---

## 2. Tech stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Runtime / PM / tests | **Bun** (workspaces, `bun test`) | Never npm/npx; use `bun`/`bunx`. CAVEAT: the web head's server code executes on **Node** (nitro runtime) — no `Bun.*` globals in `apps/web` or anything it imports; shared utils stay portable (`generateId` precedent) |
| Language | **TypeScript strict, ESM only** | No `any`; `unknown` + guards |
| Lint/format | **Biome** | One config at root; CI + pre-commit |
| Frontend | **TanStack Start + Router** | Design comes from the redesign demo |
| Server state | **TanStack Query** | Key factories, `staleTime`, `signal` — see §9 |
| Dashboard data | **TanStack server functions** → `db/services` | NO internal REST. HTTP API is public-only |
| HTTP API | **Hono** | Webhook ingest + SSE now; zod-openapi public surface post-MVP |
| DB | **Postgres** (local: docker-compose; deployed: PlanetScale) + **Drizzle** | |
| Queue | **pg-boss** | Same DB. Transactional enqueue |
| Realtime | **SSE** from `apps/api`, fed by Postgres LISTEN/NOTIFY | Fallback: 2s cursor polling — decide at build step 4, not before |
| Auth | **Better Auth** — GitHub OAuth only at launch | Neutral `user` + `forge_identities`; see §10 |
| Review agent | **AI SDK** (`ai`), provider-agnostic — **OpenRouter** default via `AI_REVIEW_MODEL` slug; explicit rule config wins | No eve, no Chat SDK, no LangChain. See §8 |
| Workflow editor | **React Flow (xyflow)** | Built LAST (step 10) |
| IDs | **UUIDv7** everywhere | Time-sortable → index locality for the event store |
| Logging | **pino**, request IDs threaded into worker jobs | Never `console.log` |
| Validation | **Zod** — schemas live in `packages/contracts` only (boundaries) | Domain-internal validators may use Zod locally |

---

## 3. Monorepo layout

```
tripwire/
├── AGENTS.md                     # root rules (see §12)
├── .claude/rules/                # full rule docs that scoped agents.md files link to
├── biome.json  bunfig.toml  package.json  tsconfig.base.json
├── docker-compose.yml            # local postgres (+ api/worker services at deploy time)
├── packages/
│   ├── auth/                     # @tripwire/auth — Better Auth factory (./server) + browser client (./client)
│   ├── contracts/                # @tripwire/contracts — Zod schemas + types. THE shared language
│   ├── forge/                    # @tripwire/forge — ForgeAdapter interface + types ONLY
│   ├── core/                     # @tripwire/core — pure engine: rules, executor, scoring
│   ├── forge-github/             # @tripwire/forge-github — the GitHub adapter
│   ├── db/                       # @tripwire/db — drizzle schema + services layer
│   ├── ui/                       # @tripwire/ui — design-system PRIMITIVES only
│   └── utils/                    # @tripwire/utils — shared helpers so agents never redefine them
└── apps/
    ├── web/                      # TanStack Start dashboard (the redesign demo lives here)
    ├── api/                      # Hono: webhook ingest, SSE, (post-MVP) public OpenAPI
    ├── worker/                   # pg-boss consumers: normalize, execute, act, rollup, replay
    └── mcp/                      # POST-MVP. Do not scaffold beyond an empty folder + agents.md
```

### Dependency arrows (the actual architecture — enforce in CI)

```
contracts     ← everything            (imports nothing but zod)
utils         ← everything except contracts
forge         ← forge-github, worker  (interface + types only; imports contracts)
core          ← worker ONLY           (pure: imports contracts + utils only.
                                       NO I/O, no db, no forge, no AI SDK, no octokit.
                                       Effects are INJECTED — see §8)
db            ← worker, api, web      (schema + services)
auth          ← web, api              (./server: createAuth + fail-closed posture
                                       guard; ./client: browser client, never
                                       imports server code. imports db + utils)
forge-github  ← worker, api           (api uses webhook verify only)
ui            ← web                   (primitives; no app logic, no data fetching)
apps import packages; packages NEVER import apps; nothing imports core except worker.
```

A CI script (`scripts/check-boundaries.ts`) fails the build on any wrong-direction
import. Write it in the first session — at agent speed, structure is documentation.

---

## 4. Package contents

### `packages/contracts` — the shared language
Zod schemas + inferred types. No functions, no I/O, no deps except zod. Extracted
from the redesign demo's mock data — **the demo's shapes are the contract; the
backend's job is to satisfy them.**

```
src/
  events.ts        # NormalizedEvent, EventKind, payload discriminated union
  runs.ts          # Run, RunStep, Verdict = 'pass' | 'block' | 'needs_review'
  rules.ts         # RuleResult envelope { ruleId, version, status, passed, evidence, evaluatedAt }
                   #   + RuleTarget = 'change-request' | 'comment' | 'issue' (see §6)
  review.ts        # AiReviewOutput (see §8 — the schema IS the muzzle)
  check.ts         # CheckState (see §7 — the merge-gate contract)
  contributor.ts   # ContributorSummary, signal shapes
  repo.ts          # Repo, RepoConfig
  content.ts       # content-rule config/evidence shapes + ContentMatch index row (§6)
  workflow.ts      # WorkflowDefinition JSON DAG: trigger/rule/gate/action nodes + edges.
                   #   Actions split by trigger kind: gate actions (block/comment/label/
                   #   request-review/send-to-moderation) vs content actions (hide-comment/
                   #   label/send-to-moderation). validate enforces target/action fit (§6)
  index.ts
```

### `packages/forge` — the seam
`ForgeAdapter` interface + supporting types (`RawForgeEvent`, `ForgeAction`,
`DiffFile`, `ContributorProfile`, …). **Nothing else, ever.** No helpers, no base
classes, no shared utils — the moment convenience code lands here it becomes a
dumping ground both adapters depend on. Exists from day 1 specifically so future
agent sessions see the pattern (`forge-gitlab` will be a sibling implementing this
interface, never importing `forge-github`).

Adapter surface, three responsibilities:
1. **Inbound** — verify webhook signature; normalize raw payload → `NormalizedEvent`
2. **Reads** — fetch what rules need: diff, files, commits, contributor profile → builds `RuleContext`
3. **Actions** — block / label / comment, and `setCheck(sha, conclusion, summary,
   detailsUrl)` — the forge's native merge-gating primitive. Every forge has one
   (GitHub: Checks API; GitLab: commit status / external status checks;
   Gitea/Forgejo: commit statuses), so the abstraction is forge-neutral by
   construction. All idempotent.

### `packages/core` — the pure engine
```
src/
  rules/
    define.ts        # defineRule({ id, version, configSchema, resultSchema, evaluate })
    registry.ts      # typed registry keyed by `id@version`
    account-age.ts   min-merged-prs.ts   pr-rate-limit.ts   max-files-changed.ts
    english-only.ts  crypto-address.ts   honeypot.ts        profile-readme.ts
                     # crypto-address also declares target: 'comment' (already text-matching)
    content/         # comment/issue-target rules (§6): spam-domains.ts, blocked-terms.ts,
                     #   custom-pattern.ts (RE2-class / timeout+length cap — untrusted regex),
                     #   comment-burst.ts. Same defineRule primitive, different target.
    ai-review/
      rule.ts          # evaluate delegates to injected generate() — core never imports the AI SDK
      instructions.md  # versioned WITH the rule; material prompt change ⇒ version bump
      template.md
  workflow/
    executor.ts      # boring DAG walk: topo order, gate short-circuit, record every step.
                     #   A node whose rule is disabled for the repo is skipped
                     #   (skipped: disabled, conducts as pass, off the degradation floor — §6)
    validate.ts      # + target/action compatibility (no block under a comment trigger,
                     #   no hide-comment under a change-request trigger — §6)
    derive.ts        # derive the default workflow from enabled rules when a repo has
                     #   no saved workflow (§6 toggle semantics; no DEFAULT_WORKFLOW constant)
  scoring/
    score.ts         # 0–100 composition
    signals.ts       # ABSTRACT signal taxonomy: identity-investment, community-standing,
                     # contribution-history, red-flags. Platform packages register named
                     # signals INTO categories; core never knows "sponsors" exists.
                     # Missing categories are modeled — a barren Forgejo degrades gracefully.
  context.ts         # RuleContext — everything a rule may read, pre-fetched by the worker
```

**Purity is the law:** expected outcomes are values, not exceptions. A rule that
can't evaluate returns `{ status: 'skipped', reason }`; throws are reserved for bugs.
One flaky GitHub call degrades one rule's evidence, never the whole run.

**Versioning is the law:** a stored run references `account-age@1` forever, even
after `@2` ships with different semantics. Old runs must stay interpretable.

### `packages/forge-github`
```
src/
  adapter.ts           # implements ForgeAdapter
  webhook/verify.ts    # HMAC (X-Hub-Signature-256)
  webhook/normalize.ts # raw GitHub payload → NormalizedEvent
  client/auth.ts       # App JWT → installation tokens, cached
  client/reads.ts      # diff, files, contributor profile → RuleContext inputs
  actions/execute.ts   # block/label + idempotency hooks
  actions/check.ts     # Checks API: check run `tripwire` per head SHA (see §7)
  actions/comment.ts   # THE condensed comment (see §7)
fixtures/              # captured REAL payloads + API responses. Never hand-written.
```

### `packages/db` — persistence + the service layer
"No logic in route handlers / server functions" only works if logic has a home. This
is it. All three heads (web, api, worker) call these services.
```
src/
  schema/
    events.ts      # id uuidv7, raw jsonb, normalized cols, delivery_id UNIQUE, received_at.
                   #   kinds include comment/issue ingest: issues.opened, issues.edited,
                   #   issue_comment.edited (spammers post clean, edit dirty) — §5
    runs.ts        # runs (workflow_snapshot jsonb!) + run_steps (evidence jsonb, timings)
                   #   + run_actions rows (rows-first, idempotent; content actions store the
                   #   reversal handle e.g. comment node id for unhide) — §6
    repos.ts       # repos, rule_configs (enabled flag = kill switch, §6), workflow_definitions
    content.ts     # content_matches — thin index over content-rule failures for /rules counts;
                   #   derived data, rebuildable from runs (§6)
    moderation.ts  # moderation items = paused runs
    rollups.ts     # daily per-repo stats for Home + per-rule match rollups for /rules sparklines
    auth.ts        # Better Auth tables + forge_identities
  services/
    events.ts      # insertRawEvent (tx: insert + pg-boss enqueue), listEvents (cursor)
    runs.ts        # createRun, recordStep, getRunWithSteps, resumeModerated
    repos.ts       # config CRUD, installation sync
    insights.ts
  client.ts  migrate.ts
drizzle/           # generated migrations
```
DB conventions: snake_case columns (Drizzle maps to camelCase), `timestamptz`
always, every jsonb column has a contracts schema validated **on write**.
> Note in db/agents.md: services may split into `packages/services` if they outgrow
> db. **Do not create that package before then.**

### `packages/auth` — sessions (owner-added post-step-8; layout amendment in DECISIONS.md)
Two entrypoints, deliberately split so the client bundle can never pull server
code: `./server` (Better Auth instance factory over `@tripwire/db`'s schema +
`resolveAuthPosture` — missing BETTER_AUTH_SECRET refuses to serve when
NODE_ENV=production, stands open in dev) and `./client` (the browser auth
client). The HTTP surface is mounted by the WEB head (see §10).

### `packages/ui` — primitives only
Design-system primitives (button, input, card, dialog, badge, chart shells…) lifted
from the redesign demo. Rules: no app logic, no data fetching, no domain types,
props-driven chrome (a consumer reaching for `className` to change chrome is a smell
— expose a prop). Custom app-specific composition lives in `apps/web/components`.

### `packages/utils` — so agents never redefine helpers
`id.ts` (`generateId()` = UUIDv7 — **never** `crypto.randomUUID`/nanoid directly),
`errors.ts` (`toError`, `getErrorMessage`), `time.ts` (`sleep`), `string.ts`
(`truncate`), `retry.ts` (`backoffWithJitter`). Check here before writing any inline
helper. New helper used by 2+ files → it moves here.

### `apps/api` — thin
```
src/
  index.ts
  routes/webhooks.ts   # POST /webhooks/github — verify → tx(insert+enqueue) → 200. NOTHING else.
  routes/stream.ts     # GET /events/stream — SSE off LISTEN/NOTIFY
  routes/public/       # post-MVP: @hono/zod-openapi createRoute() defs → spec + Scalar docs
  middleware/auth.ts
```
Handlers are parse → service call → respond. A query in a route handler is in the
wrong layer.

### `apps/worker` — the muscle, where I/O meets the pure core
```
src/
  index.ts
  jobs/process-event.ts  # normalize → match workflows by trigger → build RuleContext via
                         # adapter → core executor → persist run+steps → actions → upsert comment
  jobs/rollup.ts         # daily Home stats
  jobs/replay.ts         # verdict replay over event history (CI gate + research pipeline)
  notify.ts              # pg NOTIFY on normalized-event insert
```

### `apps/web` — the dashboard
Four surfaces: **Home** (rollup charts) · **Workflows** (React Flow editor — last) ·
**Rules** (the rules page — absorbs the old automod mockup's charts/toggles UI over
real data; per-rule cards, target chips, kill-switch toggles, sparklines; §9) ·
**Insights**. Plus `/events`, `/runs/$runId`, `/moderation`. The old `/automod`
page is **deleted** — its UI folds into `/rules`, its targets into the rule
primitive (§6). Redesign demo lands here day 1 on mocks; `src/mocks/` shrinks to
empty as build steps land. Structure in §9.

---

## 5. Data & ingestion (every step of how data moves)

```
GitHub ──webhook──▶ apps/api POST /webhooks/github
  1. verify HMAC (forge-github/webhook/verify)          — reject ≠ 401
  2. ONE transaction: insert raw event + enqueue pg-boss job
  3. idempotency: UNIQUE(delivery_id) from X-GitHub-Delivery — redelivery = no-op
  4. return 200 in single-digit ms. NOTHING else in the request path.
──▶ worker process-event
  5. parse raw payload with contracts schemas (production IS a test execution —
     parse failure = quarantine event + auto-capture as fixture candidate + log)
  6. write NormalizedEvent, NOTIFY 'events'
  6b. change-request events: emit `pending` check for the head SHA immediately —
     the merge button is held during evaluation, not just after it
  7. match enabled workflows by trigger for the repo (or DERIVE the default from
     enabled rules when the repo has no saved workflow — §6). comment/issue events
     (issues.opened, issues.edited, issue_comment.edited) skip 6b and drive content
     rules → content actions; change-request events drive the gate as before
  8. build RuleContext through the adapter (all reads happen HERE, pre-fetched)
  9. core executor walks the DAG; every node's input/output recorded as run_steps
 10. persist run — SNAPSHOT the workflow definition onto the run (edits later must
     not change what a historical run page shows)
 11. multiple workflows fired on one event ⇒ JOIN into one run (one button on the PR)
 12. execute actions through the adapter — actions recorded as rows first, marked
     executed after (crash mid-run must not double-block on retry)
 13. emit the check run + upsert the PR comment (§7) — same persistence step,
     never allowed to disagree
──▶ apps/api SSE fan-out (LISTEN 'events') ──▶ TanStack Query cache merge ──▶ UI live
```

Append-only is sacred: raw payloads are never mutated or deleted. They are the
fixture library, the replay corpus, and the future ML dataset.

---

## 6. Rules & workflows

**Three words, no fourth: rule · workflow · run.** A **rule** is one yes/no check
that declares its target. A **workflow** is the recipe — which events trigger
which rules and what happens on pass/fail — and is the ONLY thing that executes.
A **run** is the receipt. "Automod" is not a fourth concept: what the mockup
called automod was a better rules UI plus a new class of rule targets
(comments/issues). Both are absorbed — the UI into `/rules` (§9), the targets into
the rule primitive below.

### Rules (targets)
- **Rule** = single boolean requirement all non-exempt users of a repo must meet
  (org members / maintainers exempt). Primitive: Zod config schema + Zod result
  schema + `evaluate(ctx, config)`. Results serialize as validated JSON on the
  server; the typed registry is what gets exposed to the SDK later — **types in
  code, JSON on the wire.**
- **Every rule declares a `target`:** `"change-request" | "comment" | "issue"`.
  A rule version may support several; the workflow trigger decides which context
  it receives. Same `defineRule` primitive, same `id@version`, same registry,
  same envelope law. **The executor does not change — only the `RuleContext` the
  worker builds differs per trigger kind.**
  - **change-request rules** (all 9 existing): context = contributor + diff + PR
    metadata. Verdict feeds the merge gate (check / comment / review).
  - **comment / issue rules** (new class): context = the posted text + author
    signals. Verdict feeds CONTENT actions, never the merge gate.
- **Evidence** is rule-specific typed payload (actual account age, the CoV value
  that tripped spray detection). Evidence is what makes the run page and appeals
  real instead of "computer says no."

### Workflows (actions, closed vocabulary split by trigger kind)
- **Workflow** = node-based composition: trigger nodes (PR opened / comment /
  push / issue) → rule nodes → gate nodes (all-of / any-of / not) → action nodes.
  Serialized as a JSON DAG in `contracts/workflow.ts`. The executor eats this JSON
  from build step 6; the React Flow editor that *emits* it comes last — the engine
  is validated with hand-seeded definitions long before the editor exists.
- **Gate actions** (change-request triggers only): `block`, `comment`, `label`,
  `request-review`, `send-to-moderation`.
- **Content actions** (comment / issue triggers only), all REVERSIBLE:
  - `hide-comment` — GitHub `minimizeComment` (GraphQL). The workhorse.
  - `label` — on the parent issue/PR.
  - `send-to-moderation` — same queue, same paused-run semantics.
  - **NEVER auto-delete.** Deletion is a human verb in the moderation queue.
  - `lock-thread` — deferred (escalation, post-v1; cut list).
- **`workflow/validate.ts` enforces target/action compatibility:** a `block` node
  downstream of a comment trigger is a validation error, and a `hide-comment`
  node under a change-request trigger is too.

### Toggles: kill switch, and defaults are derived
The `/rules` and `/workflows` pages stay fully separate (owner decision). A rule
toggle never silently does nothing — its meaning depends on whether the repo has
a saved workflow:
- **Repo with NO saved workflow:** the workflow is DERIVED from the toggles —
  "on change-request → every *enabled* change-request rule → all-of gate → block
  on fail"; the same derivation covers content ("on comment/issue → every enabled
  content rule → content actions"). Toggle ON = the rule runs; toggle OFF = it
  doesn't. There is no fixed `DEFAULT_WORKFLOW` constant — the default *is* this
  derivation.
- **Repo WITH a saved custom workflow:** the graph wins. Toggle OFF is a **kill
  switch** — nodes referencing that rule are skipped at execution (recorded
  `skipped: disabled`, conducts as pass, and **excluded from the degradation
  floor**: disabled is deliberate, degraded is accidental). Toggle ON does NOT
  insert nodes; the rule's card shows a **"managed by your workflow"** tag.
- The worker consults `rule_configs.enabled` at node evaluation. This is the one
  engine change the unified-rules work requires; everything else is UI + new
  targets over the unchanged executor.

### Moderation & the content pipeline
- **Moderation queue = a paused run**, not a separate system. `needs_review`
  verdict halts the run, creates a moderation item; approve/deny resumes down the
  corresponding edge. Audit trail, run page, and PR button work identically for
  moderated and automatic outcomes.
- **Content evaluations are runs too.** Comment/issue triggers are ordinary
  trigger nodes; their evaluations persist as runs + run_steps (auditable,
  replayable, deep-linkable) exactly like change-request runs. Content actions are
  `run_actions` rows (rows-first, idempotent) that store the **reversal handle**
  (the comment node id, for unhide). `content_matches` is a thin index over
  content-rule failures for the `/rules` counts — derived data, rebuildable from
  runs.
- **v1 content rule set (small, dumb, effective):**
  - `spam-domains@1` — Tripwire-curated global domain list + per-repo additions.
  - `blocked-terms@1` — per-repo custom term list.
  - `custom-pattern@1` — user regex. **HARD REQUIREMENT: linear-time matching
    (RE2-class) or a timeout guard + input-length cap.** Untrusted regex is a
    denial-of-service invitation.
  - `comment-burst@1` — account age × comment velocity heuristic; reuses
    contributor signals.
  - `crypto-address@1` gains `target: "comment"` (it already matches text).
  - Classifiers (profanity / harassment / NSFW) are DEFERRED (cut list): word
    lists are bad harassment detectors, per-comment LLM calls are a cost bomb, and
    the FP loop below must accumulate labels first. Same cold-start doctrine as
    scoring ML — heuristics first, model later.
- **Edge policies (locked):**
  - Never scan Tripwire's own comments (marker check) or App/bot-authored content
    by default.
  - Maintainer / org-member exemption applies (also solves the quoting problem: a
    maintainer citing a spam domain isn't spam).
  - Strip fenced code blocks before term/profanity matching; KEEP them for
    URL/domain matching.
  - **Wave batching:** matches by one actor within a window collapse into ONE
    moderation item / one summary action set — never 200 hide calls + 200 queue
    items. Heavy content matches emit a red-flag signal into contributor scoring
    (the two planes share intelligence, not machinery).
  - PR descriptions are out of scope for v1 (the gate already reads them; a PR body
    can't be minimized, so actions would collapse to `label` anyway).

### The false-positive loop
Every reversal is a label. A moderation item from rule X approved-as-fine ⇒ false
positive for X; upheld ⇒ true positive; an **unhide** of a hidden comment ⇒ FP.
FP rate = reversals / actions over the window, per rule. This requires an unhide
affordance on content moderation items (v1 ships it — reversibility is the point
of `hide-comment`). Below a floor N the stat renders honestly ("not enough data"),
never a fake percentage. This loop is also the classifier training set accruing
quietly — same doctrine as scoring: heuristics first, model later, labels from
real decisions.

### Redundancy ledger (what "automod" resolves into)
The mockup's pull-scoped rows were never a separate system — they map onto the
rule primitive: workflow tampering = `honeypot@1` (exists) · destructive-PR guard
= a **new change-request rule** (mass-deletion evidence over the diff) wired to
`send-to-moderation` · tracking pixels = a change-request rule or an `ai-review`
finding class. Home's mock queue list is replaced by real moderation items (one
queue, two views — a preview of `/moderation`). During mock-shrink the demo
`automod.ts`-descended types squatting in `contracts` get cleaned, and the old
enum values (flag / hide / close) reconcile to the surviving vocabulary above
(gate actions + content actions) — no code lands in this docs pass.

---

## 7. The PR surface (locked UX decisions)

Two artifacts per PR, always in sync, both emitted at the end of a run:
**one comment** (the human-readable face) and **one check run** (the merge gate).
This section is the *change-request* surface. Content-rule outcomes on
comments/issues (§6) never emit a check or touch the merge gate — they hide the
offending comment, label the parent, or open a moderation item, and their run
lives on the same run page.

### The comment
**As condensed as possible. One comment. Never a CodeRabbit essay.**

- Comment = a contributor-facing verdict line (`**tripwire: blocked/passed/
  sent to review** — one sentence`, constitution voice) THEN a
  `<details><summary>for maintainers</summary>` collapsible holding the run
  deep-link as the **"View on Tripwire" button**. The reason is for everyone;
  the run button is a maintainer action, tucked away so it never clutters the
  contributor's view — the two read as one cohesive message.
- The button is a hosted PNG of the dithered Geist-Pixel design (GitHub
  comments render no shaders/custom fonts, so it is `<a><img width=185>`,
  verdict-neutral, served at `${appUrl}/badges/view-run.png`).
- Hidden marker `<!-- tripwire:run -->` in the comment body; subsequent events on
  the same PR **edit** the comment (upsert), never append. Tripwire never litters
  a thread.
- The request-changes **review** (unprotected-repo friction, §4) restates NO
  verdict — a one-liner deferring to the tripwire comment keeps the comment
  the single source of truth.
- Multiple workflows on one PR ⇒ joined into one run ⇒ still exactly one button.
- All depth (per-rule steps, evidence, AI findings, timings) lives on the run
  page — which a blocked contributor MUST be able to read (see §10 access model).

### The check run (the merge gate) — MVP scope
Tripwire gates merges through the forge's **native check primitive**, emitted
server-side by the App via `setCheck` — never through a workflow file in the
customer's repo. Rationale (locked): a GitHub Actions engine can't work here —
fork PRs get read-only tokens and no secrets, `pull_request` runs the PR's own
copy of the workflow (the contributor can edit the gate), and
`pull_request_target` workarounds are a known vulnerability class. The App-side
check has none of these problems and needs zero YAML from the customer.

- One check run named **`tripwire`** per head SHA. Conclusion maps from the
  joined run's verdict: pass → `success` · block → `failure` ·
  `needs_review` → `neutral` with an "awaiting moderation" summary, then
  **updated in place** when the moderation decision resumes the run.
- Check summary = the same verdict line + run deep-link as the comment
  (`details_url` → the run page). The check is the gate; the comment is the face.
  They must never disagree — both are emitted from the same run persistence step.
- New push ⇒ new SHA ⇒ new check (GitHub semantics); the comment upserts as
  before. Re-run of the same SHA upserts the existing check (idempotency rows
  cover checks exactly like comments).
- Onboarding tells maintainers to mark `tripwire` as a **required status check**
  in branch protection — that's what turns the verdict into a dead merge button.
  Tripwire never mutates branch protection itself (cut list).
- Contract: `CheckState = { sha, conclusion: 'success' | 'failure' | 'neutral' |
  'pending', summary, detailsUrl }` in `contracts`; `setCheck` is a first-class
  `ForgeAction`. GitLab/Gitea map to commit statuses later — the abstraction is
  already forge-neutral.
- A `pending` check is emitted as soon as the worker picks up the event, so the
  merge button is held during evaluation, not just after it.

**Marketplace GitHub Action = cut list.** If ever built, it is a dumb client of
the API ("what's the verdict for this SHA") — a distribution surface like the
SDK, never a second engine.

---

## 8. Review agent (locked decisions)

- Runtime: **AI SDK** called from the **worker**, inside rule `ai-review@1`.
  Provider-agnostic: **OpenRouter** (`@openrouter/ai-sdk-provider`,
  `OPENROUTER_API_KEY`); the model is a slug — `AI_REVIEW_MODEL` env is the
  default, explicit rule config wins; the resolved model persists in the trace.
- **Inversion keeps core pure:** `evaluate` receives an injected `generate()` fn
  and pre-fetched context. Core never imports the AI SDK or the adapter.
- **Bounded tool loop, not an open agent:** tools are thin wrappers over the
  `ForgeAdapter` read surface (getDiff, readFile, getCommits, getContributorContext)
  — never `@github-tools/sdk` or any GitHub SDK (that reintroduces the coupling
  through the back door). Hard cap ~10–15 steps + token budget. Diff provided up
  front so trivial PRs resolve in one step, zero tool calls.
- **Output is structured, never prose** — the schema is the muzzle that makes the
  one-button UX structurally enforceable:
  ```ts
  // contracts/review.ts
  { verdict: 'pass' | 'block' | 'needs_review',
    confidence: number,          // 0–1
    summary: string,             // ONE sentence, hard length limit
    findings: Finding[] }        // max 5: { severity, file, line?, note }
  ```
  The presenter physically cannot write an essay; findings render on the run page.
- Result is a normal `RuleResult` envelope ⇒ composes in workflows
  ("ai-review says needs_review AND account-age < 30d → moderation queue"),
  snapshots into runs, replays in the verdict-diff pipeline like every other rule.
- `instructions.md` + `template.md` are **versioned with the rule** — material
  prompt change ⇒ `ai-review@2`. Prompts are code; runs must stay interpretable.
- Every invocation's full trace (messages, tool calls, tokens, cost) persists in
  the run step's evidence: it answers "show me why" on appeal, and quietly accrues
  the labeled-ish dataset for the (cut-listed) ML layer.
- Port the review process from `~/tripwire-eve-demo` — instructions, format, tool
  flow. The eve runtime stays behind.

---

## 9. Frontend conventions

### Route composition (the pattern, verbatim spirit)
`route.tsx` files are **thin**: no exported function components, no JSX beyond
wiring. They bind a component, a skeleton, and SEO — nothing else.

```tsx
// apps/web/src/routes/_app/users/$username.tsx
import { createFileRoute } from "@tanstack/react-router"
import {
  UserProfilePage,
  UserProfilePageSkeleton,
} from "#/components/users/profile/user-profile-page"
import { buildSeo, formatPageTitle } from "#/lib/seo"

export const Route = createFileRoute("/_app/users/$username")({
  component: UserProfilePage,
  pendingComponent: UserProfilePageSkeleton,
  head: ({ params, match }) =>
    buildSeo({
      path: match.pathname,
      title: formatPageTitle(`@${params.username}`),
      description: `GitHub profile and Tripwire contributor score for @${params.username}.`,
      type: "profile",
    }),
})
```

Layering: **route.tsx → page component (client) → abstracted UI/layout components
→ tailwind + logic per component.** Every page component ships a sibling
`*Skeleton` used as `pendingComponent`. Every route calls `buildSeo` in `head()`.
Private/dashboard routes use `PRIVATE_ROUTE_HEADERS` (noindex).

Port `lib/seo.ts` (buildSeo / formatPageTitle / summarizeText / toAbsoluteUrl /
buildWebSiteSchema / buildSoftwareApplicationSchema) + a `site-config.ts` into
`apps/web/src/lib/` — drop the deprecated back-compat shims; greenfield starts on
`buildSeo` only.

### Component organization — `components/<feature>/<part>`
It needs to look pretty for devs:
```
apps/web/src/components/
  home/            header.tsx  activity-chart.tsx  verdict-summary.tsx
  events/          event-list.tsx  event-row.tsx  live-indicator.tsx
  runs/            run-page.tsx  step-card.tsx  evidence-view.tsx  ai-findings.tsx
  rules/           rule-card.tsx  rule-config-form.tsx  rule-header-stats.tsx
                   #   match-sparkline.tsx  rule-filters.tsx  (absorbs the automod mockup)
  workflows/editor/ canvas.tsx  rule-node.tsx  gate-node.tsx  action-node.tsx  trigger-node.tsx
  moderation/      queue.tsx  review-item.tsx  unhide-action.tsx
  layout/          app-shell.tsx  sidebar.tsx  nav.tsx
```
Primitives → `packages/ui`. Custom app UI → here. Extract when 50+ lines, used in
2+ files, or owns state; keep inline when <10 lines, single-use, presentational.

### The rules page (`/rules` — the absorbed automod mockup over real data)
The old automod mockup's charts/toggles UI *becomes* the rules page, populated by
real data — no new analytics system.
- **Header stats (4 cards + sparklines):** active rules · matches 24h (rule-node
  fails across runs + content matches) · actioned 24h (executed run_actions +
  content actions) · FP rate (§6 loop; "not enough data" below the floor).
- **Per-rule cards:** name + `id@version` chip · target chip (PRs / comments /
  issues) · action summary ("block · pull", "hide · comment") · enabled toggle
  (kill switch, §6) · 24h match count · sparkline over the window · config editor
  (JSON textarea now, per-field later) · **"managed by your workflow" tag** when
  the repo has a saved workflow (§6). There is **no "not wired" state** — derived
  defaults make it impossible for no-workflow repos, and the managed tag covers
  custom ones.
- **Filters:** target (all / PRs / comments+issues) · sort: most active · FP rate
  · A–Z. The mockup's matcher-type chips (blocklist / heuristic / classifier /
  regex) become a `kind` tag on rule metadata — filterable, not structural.
- **Data sources:** change-request matches derive from run_steps (already stored);
  content matches from `content_matches` (§6); sparklines from the daily/hourly
  rollup extension.

> **Future editor palette (owner vision, post-v1 — cut list for now):** the React
> Flow editor gains **signal nodes** (trigger / rule / gate / action nodes already
> exist — only SIGNAL nodes are deferred). Not built in v1.

### Data conventions
- Server state: TanStack Query fed by server functions calling `db/services`.
  Never `useState` + `fetch` for server data. **Keep `useEffect` usage down** —
  if an effect syncs server data, it should be a query; if it derives state, it
  should be `useMemo`; refs for stable callback deps.
- Hierarchical query-key factories per domain
  (`all → lists() → list(x) → details() → detail(id)`); explicit `staleTime` on
  every query; forward `signal`; `keepPreviousData` only on variable-key queries;
  targeted invalidation; `onSettled` (not `onSuccess`) for optimistic reconciliation.
- SSE stream merges into the Query cache — the live event list is a cache update,
  not a parallel state system.

### Imports & naming
- Absolute imports always: `#/` inside `apps/web` (imports field), `@tripwire/*`
  across packages. Never relative `../../..`.
- Import order: react/core → external → `@tripwire/ui` → `#/lib` → stores/queries
  → feature → CSS. `import type` for type-only.
- Files **kebab-case** (`event-list.tsx`, `account-age.ts`) — including utils and
  core. Components PascalCase. Hooks `use-*`. Constants SCREAMING_SNAKE_CASE.
  Interfaces PascalCase with suffix (`EventListProps`). Rule ids kebab-case with
  version: `account-age@1`. DB snake_case. Barrel `index.ts` at 3+ exports; never
  re-export from non-barrels.

---

## 10. Auth (locked)

- Better Auth, **GitHub OAuth only** at launch (every day-1 user is a GitHub
  maintainer). Email/magic-link → cut list.
- **Transport (learned during live bring-up):** the WEB head serves
  `/api/auth/*` itself via a `createStart` request middleware (`src/start.ts`)
  — same-origin cookies, OAuth callback on the web origin, no proxy. WHY: vite
  `server.proxy` never fires under the nitro-owned request pipeline, and this
  @tanstack/react-start version has no file-based server routes; the request
  middleware runs before routing and is the sanctioned interception point.
  The same middleware is the precedent for any endpoint the browser must
  reach same-origin with credentials (e.g. the SSE proxy).
- **Nothing in the schema ever references a GitHub ID as a user identifier.**
  Domain tables FK to `user.id` (UUIDv7). GitHub identity lives in exactly two
  places: Better Auth's `account` table (sign-in) and `forge_identities`
  (user_id, forge, external_id, username, credentials) — present from day 1,
  GitHub-only rows for now. GitLab later = add provider config + allow a second
  row. Zero migration.
- **Contributors never authenticate.** Scored subjects exist as forge-scoped
  identities in event/scoring data — never in the auth system. Only maintainers
  log in.

### Access model — viewing is public, deciding is gated (locked)
A blocked contributor MUST be able to read the judgment against them, or the
condensed-comment UX becomes "computer says no, now sign up to find out why" —
and they *can't* sign in (contributors never authenticate, above). So the run
page is unlisted-public, gist-style:
- **`/runs/{id}` is public, read-only.** UUIDv7 ids are unguessable → only
  people who saw the badge (PR participants) reach it. The PUBLIC view renders
  verdict, per-rule steps, evidence, and ai-review **findings** — but NOT the
  ai-review raw trace (tool calls / tokens / prompt flow: internals, and mildly
  aids evasion). A "powered by tripwire" footer shows on the public view (every
  public run is a demo to exactly the audience that installs Tripwire).
- **Everything mutating or list-shaped stays session-gated:** approve/deny on a
  run, and all of `/events`, `/moderation`, `/rules`, insights, run *lists*. A
  crawlable index of every verdict across every repo is a surveillance/harassment
  surface and a different product — it must not exist.
- **Private-repo runs stay session-gated for MVP** (a link would leak repo name
  + contributor + diff-derived evidence). Revisit with repo-scoped access later.
- Dev-mode auth posture is unchanged: fail-closed in production
  (`resolveAuthPosture`), open in dev.

---

## 11. Testing (the closed loop)

**Never hand-write what reality can hand you.** Fixtures are captured real
payloads (scrubbed), never invented from docs — including GitHub *API responses*,
not just webhooks. Production parse failures auto-become fixture candidates.
Every incident ends with a fixture. The suite only gets harder to pass.

| Layer | When | What |
|---|---|---|
| Unit | every PR, seconds | rules + scorer as pure fns over fixture contexts; **property tests** (fast-check): score ∈ [0,100], red flags never raise scores, determinism |
| Contract | every PR | full fixture corpus parses + normalizes |
| Snapshot | every PR | rendered PR comments / verdict markdown vs golden files |
| Integration | every PR, ~1 min | REAL Postgres (testcontainer): webhook → tx → pg-boss → run persisted; fire same delivery-id twice ⇒ one row. Never mock Postgres — the tx + constraints ARE the logic |
| Verdict replay | CI gate on `core` changes | rerun candidate engine over event history, diff verdicts, human reviews the flips |
| Live E2E | nightly / pre-release only | sacrificial repo + test account; real PR ⇒ comment lands, deep link resolves |

Shadow mode post-MVP-launch: new rule versions record verdicts without acting;
promote only after comparing shadow vs live. CI (typecheck + biome + boundary
check + tests) runs from the **first commit** — retrofit CI is how half-baked
tests happen again.

---

## 12. The agent-governance system (`AGENTS.md` + `.claude/`)

Modeled on Sim's system (github.com/simstudioai/sim/.claude). Three tiers:
**scoped AGENTS.md** (rules inject when a session touches that area) →
**`.claude/rules/`** (full rule docs, path-scoped) → **`.claude/commands/`**
(parameterized, repeatable procedures). **Structure is documentation:** every
deliberate deferral is encoded in a file, never in memory.

```
AGENTS.md                          # root
.claude/
  rules/
    architecture.md    # dependency arrows verbatim + boundary-check explanation
    naming.md          # §9 naming block
    frontend.md        # route pattern, component org, Query rules, useEffect policy
    testing.md         # §11: fixture policy, layers, replay
    rules-engine.md    # defineRule, versioning law, evidence, purity/skipped policy
    review-agent.md    # §8 in full — output schema, bounded loop, trace persistence
    ingest.md          # §5 verbatim; paths-scoped to apps/api/src/routes/webhooks*
                       #   and apps/worker/** — the tx/idempotency rules are load-bearing
    constitution.md    # language & positioning for user-facing copy (see below)
  commands/            # see command set below
  skills/
    tripwire-design/   # SKILL.md distilling the redesign demo's aesthetic: tokens,
                       #   spacing, radius, motion. UI sessions invoke it so new
                       #   surfaces match the demo instead of inventing a look.
packages/contracts/agents.md   packages/forge/agents.md   packages/core/agents.md
packages/forge-github/agents.md packages/db/agents.md     packages/ui/agents.md
packages/utils/agents.md
apps/web/agents.md   apps/web/src/routes/agents.md   apps/web/src/components/agents.md
apps/api/agents.md   apps/worker/agents.md           apps/mcp/agents.md
```

Rule files carry **frontmatter with `description` and `paths:` globs** (Sim's
`sim-sandbox.md` pattern) so they auto-attach when matching files are touched.

### Root AGENTS.md must contain
Mission (one paragraph) · the dependency arrows verbatim · naming conventions ·
type-safety enforcement (strict, no `any`, Zod at every boundary, jsonb validated
on write) · "check `@tripwire/utils` and `@tripwire/ui` before writing any helper
or primitive — never redefine" · useEffect policy · comments policy (**TSDoc only;
no `====` separators; no non-TSDoc comments**) · CI prep (biome + typecheck +
boundary script + tests must pass; tests written alongside features, not after) ·
error convention (values in core, catch-log-retry at edges) · logging (pino only)
· ID rule (`generateId()` from `@tripwire/utils/id`, never raw uuid libs /
`crypto.randomUUID` / nanoid) · **the anti-BS block** · **the cut list** ·
"old prod repo is inspiration, never a source to copy" · "verify each build
step's *done when* before starting the next."

### The anti-BS block (verbatim in root AGENTS.md)
```markdown
## Do not add things
- NO new dependencies without a DECISIONS.md entry stating what it replaces and
  why the stack (§2 of the spec) can't do it. "Convenient" is not a reason.
- NO new top-level packages, apps, or folders. The §3 layout is closed. If work
  doesn't fit, stop and flag it — do not invent a home for it.
- NO abstractions for single consumers: no utils.ts used by one file, no base
  classes with one subclass, no "future-proofing" interfaces beyond ForgeAdapter.
- NO scaffolding beyond the current build step. Finishing early means raising
  quality, never widening scope.
- Scaffolding rules, routes, or fixtures happens through .claude/commands/ —
  never freehand. If a command doesn't exist for it, that's a signal to stop.
- Every generator command has a validator pair. Additions are audited by a
  different procedure than the one that created them.
```

### `.claude/commands/` — the command set
Commands are parameterized procedures with frontmatter (`description`,
`argument-hint`), `$ARGUMENTS`, and Sim's `[scope] [fix=true|false]` convention
where auditing applies. Write these in build step 1; they're how the repo stays
consistent across hundreds of sessions.

| Command | What it does |
|---|---|
| `/add-rule <name>` | Scaffolds a complete rule: `packages/core/src/rules/<name>.ts` via `defineRule` at `@1`, config + result schemas, registry entry, unit tests over fixture contexts, evidence shape documented. Refuses names that collide or skip the registry. |
| `/validate-rule <name>` | The auditor pair. Re-reads the rule, its schemas, registry entry, tests, and every fixture it touches; checks the §6 laws (versioning, evidence, skipped-not-thrown, determinism); reports critical/warning/suggestion, then fixes. |
| `/add-route <path>` | Scaffolds the §9 route pattern: thin `route.tsx` (component + pendingComponent + `buildSeo` head), page component + sibling Skeleton under `components/<feature>/`, query hooks with key factory. Never exports components from route files. |
| `/capture-fixture <source>` | Takes a raw payload (from the events table, a quarantined parse failure, or pasted), scrubs PII/tokens, files it under `forge-github/fixtures/` with provenance notes, and wires it into the contract-test corpus. |
| `/replay [range]` | Runs verdict replay over event history with the working-tree engine, diffs verdicts vs stored runs, and outputs the flip report (run links, rule + version responsible) for human review. |
| `/cleanup [scope] [fix]` | Composite (Sim's pattern): chains `/you-might-not-need-an-effect` → `-a-memo` → `-a-callback` → `-state` → `/react-query-best-practices` → `/ui-review`, then summarizes findings across all passes. |
| `/you-might-not-need-*` | Adopt Sim's four React anti-pattern auditors near-verbatim (effect, memo, callback, state) — each reads the react.dev doc, analyzes scope, fixes or proposes. |
| `/react-query-best-practices` | Audits hooks against §9: key factories, `staleTime`, `signal`, `keepPreviousData` placement, targeted invalidation, `onSettled` reconciliation. |
| `/ui-review [scope]` | Audits components against `packages/ui` primitives + the tripwire-design skill: primitives not re-derived, chrome via props not className, `components/<feature>/<part>` placement. |
| `/ship [notes]` | Pre-flight (biome, typecheck, boundary check, tests) → conventional commit `type(scope): description` → push → PR. **In Grim's voice: terse, lowercase, direct bullets, no fluff, no Co-Authored-By lines.** Confirms message before executing. |
| `/council <area>` | Sim's exploration command: spawn ~10 task agents to dig into an area from different angles, synthesize, then plan. For "how does X actually work now" questions before big changes. |

### `constitution.md` — language rules for user-facing copy
Sim's most underrated file: a use/never-use table so marketing/UI copy never
drifts. Tripwire's version (Grim expands over time):

| Concept | Use | Never |
|---|---|---|
| The product | "contribution gatekeeper", "firewall for your repo" | "AI code review tool", "bot", "linter" |
| The verdict | "blocked", "passed", "sent to review" | "rejected", "denied", "failed" (people fail; PRs get blocked) |
| The subject | "contributor", "change request" | "user" (users are maintainers), "PR" in agnostic contexts |
| AI-generated junk | "slop" | euphemisms |
| Comment/issue checks | "rules" (content-target rules) | "automod", "filters", "AI moderation" |
| Reversible content action | "hide", "hidden" (unhide reverses) | "delete", "remove" (deletion is a human verb) |
| Tone | terse, lowercase-friendly, zero exclamation marks | marketing superlatives |

### Scoped file template (content varies; shape is constant)
```markdown
# Core Scope
Rules for `packages/core/**`.
HARD LAW: this package is pure. No I/O, no db, no forge, no AI SDK, no octokit,
no env vars. Effects arrive injected via RuleContext / generate().
Every rule is `id@version` with Zod config + result schemas. Bump the version on
any semantic change — stored runs reference versions forever.
New rules are created ONLY via /add-rule and audited via /validate-rule.
See `.claude/rules/rules-engine.md` and `.claude/rules/architecture.md`.
```
```markdown
# Forge Scope
Rules for `packages/forge/**`.
This package contains the ForgeAdapter interface and its types. NOTHING ELSE.
No helpers, no base classes, no utils — ever. Implementations are siblings
(`forge-github`, later `forge-gitlab`) and never import each other.
See `.claude/rules/architecture.md`.
```
```markdown
# MCP Scope
POST-MVP. Do not build anything here yet. When built: thin MCP tools wrapping
`@tripwire/db` services; contracts Zod schemas convert to tool input schemas.
```
Scoped files may carry directory-specific hard rules inline (Sim's
`blocks/AGENTS.md` style) when the rules are short, or be pure pointers into
`.claude/rules/` (Sim's `hooks/queries/AGENTS.md` style) when they're not.

### The cut list (lives in root AGENTS.md — append, never delete)
GitLab / any second forge adapter · SDK publishing · public OpenAPI surface ·
marketplace GitHub Action (dumb API client only, if ever) · mutating customer
branch protection · `apps/mcp` implementation · ML layer · org-level features ·
billing ·
email/password auth · deep observability beyond pino · deployment automation ·
content classifiers (profanity / harassment / NSFW) · `lock-thread` escalation ·
PR-description content matching · discussions / wiki / commit-message scanning ·
community report buttons · auto-delete (permanent — deletion stays a human verb in
moderation) · cross-repo content bans (scoring's jurisdiction) · signal nodes in
the workflow editor (trigger/rule/gate/action nodes already exist — only SIGNAL
nodes are deferred).
A helpful agent scaffolding `forge-gitlab` because the sibling slot visibly
exists is the same scope creep that killed v1, typing faster.

---

## 13. Build order (local-first; verify each *done when* with your own eyes)

1. **Workspace + contracts** — bun workspaces, all packages/apps stubbed with
   their agents.md; the full `.claude/` system written (rules with `paths:`
   frontmatter, the command set, constitution, tripwire-design skill); redesign
   demo copied into `apps/web` on mocks; mock shapes extracted into `contracts`;
   boundary-check script; CI green on commit one.
   *Done when:* `bun run dev` shows the demo in the new repo, typechecked
   against contracts.
2. **DB + local infra** — schemas, docker-compose Postgres, `bun db:migrate`.
   *Done when:* migrations run clean locally (PlanetScale branch can wait).
3. **GitHub App + ingest** — you register the App (webhook URL via cloudflared
   tunnel; permissions: PRs r/w, **checks r/w**, contents r, metadata; events: PRs, issue
   comments). Hono ingest route per §5.
   *Done when:* PR on a scratch repo ⇒ one `events` row; redelivery ⇒ still one.
4. **Worker + live event list** — normalize, NOTIFY; swap demo event list to a
   server function + SSE (or 2s polling — decide now).
   *Done when:* PR appears in the redesigned UI without refresh. First
   end-to-end proof.
5. **Rules registry** — defineRule + registry; port all rule logic from old prod
   as fresh implementations (old repo open as reference only); unit tests per rule.
6. **Executor + hardcoded workflow** — JSON default workflow, DAG walk, runs +
   steps persisted with workflow snapshot.
7. **Actions + the PR surface** — block, condensed one-button comment with upsert
   marker, the `tripwire` check run (pending → verdict), action idempotency rows.
   *Done when:* sockpuppet PR blocked with a failing `tripwire` check and the
   one-button comment; mark the check required in branch protection on the
   scratch repo and confirm the merge button is dead; new commit **edits** the
   comment and produces a fresh check on the new SHA.
   **Steps 1–7 = the MVP heartbeat.**
8. **Run page + rules UI + auth** — real run_steps evidence rendering; rule
   config CRUD; Better Auth GitHub OAuth gating the dashboard (served from
   the web head via start.ts request middleware — see §10 transport).
9. **ai-review port** — §8, lifted from the eve demo.
10. **Moderation queue → Home rollups → React Flow editor** (editor last: the
    engine has eaten workflow JSON since step 6, so the hardest UI lands on a
    proven engine). Public API + MCP after MVP.

Deploy later: compose file grows api/worker/Caddy services; DB moves to the
PlanetScale branch; GitHub App webhook repoints from tunnel to host. No vendor
lock-in anywhere in the stack, so the host is whatever's convenient.
