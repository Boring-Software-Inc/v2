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
| Runtime / PM / tests | **Bun** (workspaces, `bun test`) | Never npm/npx; use `bun`/`bunx` |
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
| Review agent | **AI SDK** (`ai`), Anthropic provider first | No eve, no Chat SDK, no LangChain. See §8 |
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
  review.ts        # AiReviewOutput (see §8 — the schema IS the muzzle)
  contributor.ts   # ContributorSummary, signal shapes
  repo.ts          # Repo, RepoConfig
  workflow.ts      # WorkflowDefinition JSON DAG: trigger/rule/gate/action nodes + edges
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
3. **Actions** — block / label / comment / status, idempotently

### `packages/core` — the pure engine
```
src/
  rules/
    define.ts        # defineRule({ id, version, configSchema, resultSchema, evaluate })
    registry.ts      # typed registry keyed by `id@version`
    account-age.ts   min-merged-prs.ts   pr-rate-limit.ts   max-files-changed.ts
    english-only.ts  crypto-address.ts   honeypot.ts        profile-readme.ts
    ai-review/
      rule.ts          # evaluate delegates to injected generate() — core never imports the AI SDK
      instructions.md  # versioned WITH the rule; material prompt change ⇒ version bump
      template.md
  workflow/
    executor.ts      # boring DAG walk: topo order, gate short-circuit, record every step
    validate.ts
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
  actions/execute.ts   # block/label/status + idempotency hooks
  actions/comment.ts   # THE condensed comment (see §7)
fixtures/              # captured REAL payloads + API responses. Never hand-written.
```

### `packages/db` — persistence + the service layer
"No logic in route handlers / server functions" only works if logic has a home. This
is it. All three heads (web, api, worker) call these services.
```
src/
  schema/
    events.ts      # id uuidv7, raw jsonb, normalized cols, delivery_id UNIQUE, received_at
    runs.ts        # runs (workflow_snapshot jsonb!) + run_steps (evidence jsonb, timings)
    repos.ts       # repos, rule_configs, workflow_definitions
    moderation.ts  # moderation items = paused runs
    rollups.ts     # daily per-repo stats for Home
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
**Rules** (boolean requirement config) · **Insights**. Plus `/events`,
`/runs/$runId`, `/moderation`. Redesign demo lands here day 1 on mocks;
`src/mocks/` shrinks to empty as build steps land. Structure in §9.

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
  7. match enabled workflows by trigger for the repo
  8. build RuleContext through the adapter (all reads happen HERE, pre-fetched)
  9. core executor walks the DAG; every node's input/output recorded as run_steps
 10. persist run — SNAPSHOT the workflow definition onto the run (edits later must
     not change what a historical run page shows)
 11. multiple workflows fired on one event ⇒ JOIN into one run (one button on the PR)
 12. execute actions through the adapter — actions recorded as rows first, marked
     executed after (crash mid-run must not double-block on retry)
 13. upsert the PR comment (§7)
──▶ apps/api SSE fan-out (LISTEN 'events') ──▶ TanStack Query cache merge ──▶ UI live
```

Append-only is sacred: raw payloads are never mutated or deleted. They are the
fixture library, the replay corpus, and the future ML dataset.

---

## 6. Rules & workflows

- **Rule** = single boolean requirement all non-exempt users of a repo must meet
  (org members / maintainers exempt). Primitive: Zod config schema + Zod result
  schema + `evaluate(ctx, config)`. Results serialize as validated JSON on the
  server; the typed registry is what gets exposed to the SDK later — **types in
  code, JSON on the wire.**
- **Evidence** is rule-specific typed payload (actual account age, the CoV value
  that tripped spray detection). Evidence is what makes the run page and appeals
  real instead of "computer says no."
- **Workflow** = node-based composition: trigger nodes (PR opened / comment /
  push) → rule nodes → gate nodes (all-of / any-of / not) → action nodes (block,
  comment, label, request-review, send-to-moderation). Serialized as a JSON DAG in
  `contracts/workflow.ts`. The executor eats this JSON from build step 6; the
  React Flow editor that *emits* it comes last — the engine is validated with
  hand-seeded definitions long before the editor exists.
- **Moderation queue = a paused run**, not a separate system. `needs_review`
  verdict halts the run, creates a moderation item; approve/deny resumes down the
  corresponding edge. Audit trail, run page, and PR button work identically for
  moderated and automatic outcomes.

---

## 7. The PR surface (locked UX decision)

**As condensed as possible. One button. Never a CodeRabbit essay.**

- Comment = verdict line + ONE sentence + a shields.io-style button deep-linking
  `tripwire.sh/runs/{id}`.
- Hidden marker `<!-- tripwire:run -->` in the comment body; subsequent events on
  the same PR **edit** the comment (upsert), never append. Tripwire never litters
  a thread.
- Multiple workflows on one PR ⇒ joined into one run ⇒ still exactly one button.
- All depth (per-rule steps, evidence, AI findings, timings) lives on the run page.

---

## 8. Review agent (locked decisions)

- Runtime: **AI SDK** called from the **worker**, inside rule `ai-review@1`.
  Provider-agnostic: model is a config string (Anthropic first).
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
  rules/           rule-card.tsx  rule-config-form.tsx
  workflows/editor/ canvas.tsx  rule-node.tsx  gate-node.tsx  action-node.tsx  trigger-node.tsx
  moderation/      queue.tsx  review-item.tsx
  layout/          app-shell.tsx  sidebar.tsx  nav.tsx
```
Primitives → `packages/ui`. Custom app UI → here. Extract when 50+ lines, used in
2+ files, or owns state; keep inline when <10 lines, single-use, presentational.

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
- **Nothing in the schema ever references a GitHub ID as a user identifier.**
  Domain tables FK to `user.id` (UUIDv7). GitHub identity lives in exactly two
  places: Better Auth's `account` table (sign-in) and `forge_identities`
  (user_id, forge, external_id, username, credentials) — present from day 1,
  GitHub-only rows for now. GitLab later = add provider config + allow a second
  row. Zero migration.
- **Contributors never authenticate.** Scored subjects exist as forge-scoped
  identities in event/scoring data — never in the auth system. Only maintainers
  log in.

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
`apps/mcp` implementation · ML layer · org-level features · billing ·
email/password auth · deep observability beyond pino · deployment automation.
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
   tunnel; permissions: PRs r/w, contents r, metadata; events: PRs, issue
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
7. **Actions + the comment** — block, condensed one-button comment, upsert
   marker, action idempotency rows.
   *Done when:* sockpuppet PR blocked; new commit **edits** the comment.
   **Steps 1–7 = the MVP heartbeat.**
8. **Run page + rules UI + auth** — real run_steps evidence rendering; rule
   config CRUD; Better Auth GitHub OAuth gating the dashboard.
9. **ai-review port** — §8, lifted from the eve demo.
10. **Moderation queue → Home rollups → React Flow editor** (editor last: the
    engine has eaten workflow JSON since step 6, so the hardest UI lands on a
    proven engine). Public API + MCP after MVP.

Deploy later: compose file grows api/worker/Caddy services; DB moves to the
PlanetScale branch; GitHub App webhook repoints from tunnel to host. No vendor
lock-in anywhere in the stack, so the host is whatever's convenient.
