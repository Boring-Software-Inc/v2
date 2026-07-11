# DECISIONS

Append-only log of choices made where the spec left a gap. New dependencies and
any deviation from the §3 layout MUST be recorded here (see AGENTS.md anti-BS
block). Newest at the bottom of each section.

---

## Dependencies

Everything in spec §2 is pre-approved stack and needs no entry. Recorded below
are only additions or version pins that warranted a call.

- **zod `^4`** — the validation layer is locked by §2; v4 chosen (latest major,
  matches the pre-installed `.agents/skills/zod` guidance). `@tripwire/contracts`
  is the only package that depends on it directly.
- **ultracite `^7` + biome `2.4.5`** — inherited verbatim from the redesign
  demo's lint setup (`biome.json` extends `ultracite/biome/react`). Hoisted to
  the root as the single Biome config (§2). Not a new choice; the demo's.
- **`@types/bun`** — dev-only, so `bun test` / `Bun` globals typecheck at the
  root. No runtime footprint.
- No other dependencies added. Package graph is workspace-internal only.

## Layout / structure

- **`apps/mcp` is agents.md-only.** Spec §3 says "Do not scaffold beyond an empty
  folder + agents.md"; the build-step note about stubbing "every app" is
  reconciled in the spec's favour (spec wins). No `package.json`/`tsconfig`/`src`
  there — so it is not a workspace member yet, exactly as intended.
- **Workspace dependency arrows are declared in each `package.json`** even where
  `src/index.ts` is still an empty stub, so the installed graph matches §3 from
  commit one ("structure is documentation"). `scripts/check-boundaries.ts`
  enforces the arrows against actual source imports.
- **`apps/web` keeps the demo's own `tsconfig.json`** (not extending
  `tsconfig.base.json`). The base adds `noUncheckedIndexedAccess`, which would
  spray unrelated errors across the ported demo; retrofitting that strictness is
  out of scope for step 1. New packages extend the base and get the stricter flag.
- **`apps/web` retains its `#/*` imports field and Vite/TanStack toolchain**
  unchanged. Only the lint/typecheck wiring and the type source (now
  `@tripwire/contracts`) changed.

## Contracts organisation

- **Contracts mirror the demo's mock-data domains, not §4's file names.** §4
  lists `events.ts / runs.ts / rules.ts / review.ts / repo.ts / workflow.ts` —
  those describe BACKEND shapes that do not exist in the demo yet. §4 also states
  the governing rule: "Extracted from the redesign demo's mock data — the demo's
  shapes ARE the contract." Inventing backend schemas now would violate both that
  and the anti-BS block. So step 1 ships the demo's actual domains:
  `moderation.ts, automod.ts, log.ts, contributor.ts, integrations.ts,
  repo-analytics.ts, repo-content.ts`. The §4 backend files land as the build
  steps that produce their shapes arrive (events → step 3/4, runs/rules → step
  5/6, review → step 9, workflow → step 6/10).
- **Demo `src/lib/*.types.ts` files are now thin re-exports** of the inferred
  contract types, so every `#/lib/*.types` importer is typechecked against the
  contract with zero component churn.
- **`DitherColor` moved into contracts** (`repo-analytics.ts`) because
  `RepoMetric.color` is part of a data shape. `dither-chart.tsx` now imports and
  re-exports it. The separate vendored `dither-kit/palette.ts` keeps its own
  identically-named union — it is a self-contained UI kit, not a data contract.

## Schema shapes flagged for hand review (§ "the one thing I review by hand")

Extraction is faithful to the demo: TypeScript `?` → `.optional()`, `| null` →
`.nullable()`. The tri-state / ambiguity calls Grim should sanity-check:

- **Nullable-but-required (present, may be `null`)** — modeled `.nullable()`:
  - `FlaggedItem.reporter` (null ⇒ came from automod, not a person)
  - `LogEntry.moderator` (null ⇒ pure automod action)
  - `ContributorDetails.location`
- **Optional (key may be absent)** — modeled `.optional()`:
  - `FlaggedItem.automodRule` (present only on automod-sourced items — note the
    asymmetry with `reporter`: one is nullable, the other optional, mirroring the
    demo exactly. Worth confirming both are intended.)
  - `CaughtBy.reporter`, `Comment.flag`, `ThreadDetail.branch` / `baseBranch`
  - `RepoMetric.delta` / `invertDelta` / `sub` / `suffix`
  - `ThreadAnalytics.flagged` / `checks` (issues vs PRs surface different ones)
  - `FlaggedComment.commentId`, `CheckOrReview.actor`, `ParticipantCount.flagged`
- **Enums kept CLOSED (`z.enum`)** — every string union in the demo became a
  closed enum. If any of these are expected to grow with real GitHub data,
  loosen deliberately:
  - `ItemType` (issue/pull/comment), `Reason` (spam/harassment/off-topic/automod/
    nsfw), `Severity`, `ModStatus`, `ModerationAction`
  - `RuleCategory`, `RuleAction`, `MatchVerdict`
  - `LogAction`, `LogStatus`, `CaughtKind`, `LogActionKind`
  - `ThreadKind`, `ThreadStatus`, `Visibility`, `DitherColor`
  - `ContributorActivityKind`
  - Inline-literal enums preserved as-is: `GithubAccount.type`
    (Organization/User) & `repoAccess` (all/selected); `FlaggedComment.status`
    (Hidden/Removed) & `CommentFlag.state` (Hidden/Removed);
    `CheckOrReview.kind` (review/check) & `status`
    (Approved/Changes/Passed/Failed).
- **Documented numeric ranges NOT enforced at the schema level (kept
  `z.number()`)** to avoid rejecting valid mock data on a range guess:
  - `AutomodRule.falsePositiveRate` — demo comments "Percentage, 0–100"
  - `ContributionYear.weeks[][]` — demo comments "intensity levels (0–4)"
  - `ModStat.delta` — signed
  Tighten with `.min()/.max()` if you want the schema to police these.
- **String timestamps, not `z.date()`** — every `at` / `*At` field is an ISO
  string in the demo (JSON on the wire). Left as `z.string()`; add
  `.datetime()` if you want format validation.
- **`Record<string, T>` maps preserved** (`RepoContent.issueDetails` /
  `pullDetails`, `RepoAnalytics.threads`) as `z.record(z.string(), …)`.

---

## Vocabulary reconciliation (2026-07-11 session)

`packages/contracts` renamed from the demo's domain names to the spec §4
ontology, ahead of step 2's DB schema. No runtime behavior or mock data values
changed (one flagged exception below).

### Mapping table (demo term → spec term)

| Demo file | Spec file | Demo type → spec type | Notes |
|---|---|---|---|
| `automod.ts` | `rules.ts` | `AutomodRule` → `Rule` · `AutomodMatch` → `RuleMatch` · `AutomodStats` → `RuleStats` | Alternative considered: `RuleConfig` (matches db `rule_configs`), but the shape is the Rules-surface card, not just config. `RuleCategory`/`RuleAction`/`MatchVerdict` keep their names — their VALUES are demo vocabulary (flag/hide/close vs the spec's block/comment/label) and values are locked by mock data; reconcile values when real rules land (step 5). |
| `log.ts` | `runs.ts` | `LogEntry` → `Run` · `LogStep` → `RunStep` · `LogItem` → `RunItem` · `LogAction` → `RunAction` · `LogStatus` → `RunStatus` · `LogActionKind` → `RunActionKind` | The moderation log IS the runs surface (spec: auditable runs, `/runs/$runId`). Alternative: keep "log" as a UI-only domain — rejected because step 2's `runs`/`run_steps` tables must satisfy these shapes. `CaughtBy`/`CaughtKind` keep. The §4 `Verdict` union is NOT added — no demo shape produces it yet. |
| `integrations.ts` | `repo.ts` | `ConnectedRepo` → `Repo` · `Repository` (from `moderation.ts`) → `RepoRef` | `GithubAccount`/`GithubIntegration` keep their names — they are genuinely forge-specific (App installation shapes), the adapter's vocabulary, not core's. `RepoConfig` lands with the rules UI. |
| `repo-analytics.ts` | `insights.ts` | `RepoAnalytics` → `RepoInsights` · `ThreadAnalytics` → `ThreadInsights` | Spec surface name is Insights (§4 web, `db/services/insights.ts`). Alternative: `rollups` — rejected; rollups are the daily stats tables feeding Home, a subset. `RepoMetric`, `DitherColor`, thread enums keep. |
| `moderation.ts` | `moderation.ts` (kept) | `FlaggedItem` → `ModerationItem` | "Moderation" is already spec vocabulary (§6 moderation queue, §4 db `moderation.ts`). `ModStat(s)`, `ModStatus`, `ModerationAction` (approve/remove/ban — the queue's decision verbs) keep as queue-UI shapes. |
| `contributor.ts` | `contributor.ts` (kept) | `ContributorProfile` → `ContributorSummary` | Matches §4 exactly. Signal shapes land with scoring (step 5+). |
| `repo-content.ts` | `repo-content.ts` (kept) | — | **UI-only, no spec equivalent** — issue/PR browsing shapes for the demo's repo pages. Keeps its name; expected to shrink as forge reads replace it. |

Not created (no demo shape exists; inventing them would be scope creep):
`events.ts`, `review.ts`, `workflow.ts`, `check.ts` — they land with build steps
3/4, 9, 6, and 7 respectively.

### App-side aliases (scaffolding)

The demo's thin re-export files (`apps/web/src/lib/*.types.ts`) now alias the
spec names back to the demo names (`export type { Run as LogEntry }`), so ~95
component files stay untouched and typecheck green. The aliases are explicitly
documented as scaffolding that dies with `src/mocks`; new web code imports the
contract names directly. Alternative (mass-rename all component imports now)
rejected: pure churn on files the later build steps will rewrite anyway.

### Schema tightenings (was "flagged for hand review")

- **`reporter` nullable vs `automodRule` optional** — kept both shapes (mock
  data locked) but the pairing is now ENFORCED via `superRefine` on
  `moderationItemSchema`: `reporter: null` ⇔ `automodRule` present. An item
  can no longer claim automod provenance without naming the rule, or carry both
  a human reporter and a rule. Covered by contract tests. Alternative
  considered: a discriminated union of the two provenance shapes — rejected as
  noisier (worse error messages, clunkier inferred type) for the same guarantee.
  NOTE: the session instruction for this item arrived truncated ("make it…");
  this is the spec-aligned reading — revisit if a different tri-state was meant.

### Constitution sweep exception

One mock data VALUE changed: the seeded `tripwire` repo's self-description
("GitHub moderation bot — …" → "contribution gatekeeper for git forges — …").
It is the product describing itself with a never-use term ("bot"); every other
mock value (including fictional repo names like `modkit` in seeded repo lists)
is untouched.

### Step-4 completion (same session, truncated bullets confirmed)

- **Ranges enforced:** `Rule.falsePositiveRate` → `.min(0).max(100)`;
  `ContributionYear.weeks` intensity values → `.min(0).max(4)`. All mock data
  already satisfied both; nothing fixed.
- **Timestamps:** every `at`/`*At` field is now `z.iso.datetime()` — the Zod v4
  canonical form of the requested `z.string().datetime()` (same semantics; the
  method form is deprecated in v4). Every mock builds timestamps via
  `toISOString()`, so all parse; nothing fixed.
- **Forge-derived enum notes (TSDoc only, enums stay closed):** `ItemType`,
  `ThreadKind`, `ThreadStatus`, `Visibility`, `CheckOrReview.kind`/`.status`,
  `GithubAccount.type`, `GithubAccount.repoAccess`. Each notes it needs a
  passthrough/catch variant when real ingest lands (step 3/4) — variant NOT
  added. Judgment calls: `RunStatus` (actioned/dismissed/appealed/reversed) and
  `RunAction` are tripwire's own lifecycle, not GitHub's — no note.
  `FlaggedComment.status` / `CommentFlag.state` (Hidden/Removed) describe
  tripwire moderation outcomes — no note.
- **Alias shims:** all seven `apps/web/src/lib/*.types.ts` now carry the
  standard deprecation header; the same pointer was added to
  `apps/web/src/components/agents.md`.
- **Verification:** an ad-hoc harness parsed every mock seed (14 moderation
  items, 10 rules, 7 runs, integration, insights, repo content, 3 contributor
  profiles) against the tightened schemas — all pass. Contract tests now cover
  the range bounds and datetime rejection.

---

## Autonomous run (2026-07-11) — step-by-step ledger

### Step 2 — DB + local infra

- **Deps added:** `drizzle-orm` + `pg` (runtime), `drizzle-kit` + `@types/pg`
  (dev) in `@tripwire/db`. Drizzle is §2-locked; driver choice was open — picked
  **node-postgres (`pg`)** over postgres.js because pg-boss (§2 queue) is built
  on `pg` and LISTEN/NOTIFY needs a dedicated `pg` Client; one driver everywhere
  is the boring option.
- **`generateId()` = `Bun.randomUUIDv7()`** — no uuid dependency at all; the
  runtime is Bun-locked (§2) and ships UUIDv7 natively.
- **AUTHORED — morning review target: `contracts/events.ts`** (NormalizedEvent,
  EventKind, payload discriminated union) derived from §5/§6 trigger vocabulary
  in forge-neutral terms (change-request, not PR). Kinds: change-request
  opened/updated/closed, comment.created, push.
- **AUTHORED — morning review target: `Verdict`** (`pass|block|needs_review`)
  added to contracts/runs.ts per §4.
- **Naming collision resolved — morning review target:** the vocab session
  had renamed demo `LogEntry`→`Run`; the canonical §4 backend Run
  (verdict/steps/snapshot) is structurally different from the demo's audit-log
  view. Spec wins the name: demo shapes are now `RunLog*`
  (`RunLogEntry/RunLogStep/RunLogItem/...`); web shims still alias `LogEntry`
  etc., zero component churn. Canonical `Run`/`RunStep` contracts land at step 6
  with the workflow contract.
- **Schema judgment calls:** `run_actions.idempotency_key` is unique **per run**
  (retry-dedupe); cross-run artifact identity (one comment per PR, one check per
  SHA) is the adapter's upsert job. Events table carries
  `quarantined/quarantine_reason` for §5.5 and nullable normalized cols filled
  by the worker. `repos.removed_at` soft-delete keeps history interpretable.
  `raw` jsonb is validated only as JSON on write (it is raw by definition);
  contracts validation happens at normalize (§5.5).
- **Better Auth tables hand-written** to the adapter's standard column set now
  (step 2 owns schema); Better Auth itself (dep + config) arrives in step 8.

### Step 3 — GitHub App + ingest

- **Deps added:** `hono` (apps/api — §2-locked), `pino` (§2-locked),
  `pg-boss@12` (@tripwire/db — §2-locked), `pg`/`@types/pg` (api, for types),
  `zod` (forge-github — domain-internal parsers, §2 allows), and dev-only
  `@octokit/webhooks-examples` (fixture source, below).
- **Transactional enqueue (§5.2):** pg-boss 12 `insert()` accepts a per-call
  `db.executeSql` — the job insert runs on the SAME pg client/transaction as
  the events insert. No job without a row, no row without a job. Proven by
  integration test.
- **testcontainers DROPPED:** `@testcontainers/postgresql` hangs under Bun —
  `start()` never resolves even with `Wait.forListeningPorts()` (containers
  come up healthy; the dockerode stream plumbing never settles). Replaced with
  `packages/db/src/testing.ts` `createTestDatabase()` — a docker-CLI-managed
  throwaway postgres:17 container. Same §11 guarantee (REAL postgres, real tx,
  real constraints), zero deps. Integration suite runs in ~1.6s.
- **Fixture provenance:** octokit-maintained captured payloads
  (`@octokit/webhooks-examples`, real GitHub deliveries) extracted into
  `forge-github/fixtures/` with PROVENANCE.md. Queue item 3 replaces them with
  self-captured deliveries once the App is live — octokit captures are real
  but not from OUR App's permission set.
- **AUTHORED — morning review target: `contracts/check.ts`** — verbatim from
  §7's CheckState definition.
- **ForgeAdapter interface authored** (forge/src/index.ts) from §4: inbound
  verify/normalize, reads (getDiff/getCommits/readFile/getContributorProfile),
  `execute(ForgeAction)` incl. `set-check`. `adapter.ts` object lands when
  reads exist (step 6) — interface-only until then keeps step scope honest.
- **normalize mapping judgment:** PR actions `reopened` and `ready_for_review`
  both map to `change-request.opened` (gate re-evaluates); all other PR
  actions are not ingested (null). `issue_comment` only `created`.
- **No octokit anywhere:** App JWT is RS256 via node:crypto; installation
  tokens fetched with plain fetch + cached (client/auth.ts).

### Step 4 — Worker + live event list

- **SSE chosen over 2s polling** (the §2 decision deferred to this step): the
  LISTEN/NOTIFY plumbing already existed from §5, Hono ships `streamSSE`, and
  polling would add a second data path for no gain. Fallback stays documented
  in the spec if SSE misbehaves behind proxies.
- **NOTIFY lives in `db/services/events.markEventNormalized`** (parameterized
  `pg_notify`), not a separate `worker/notify.ts` as the §4 sketch names —
  the notify belongs beside the write it announces; a one-line wrapper file
  would be an abstraction with a single consumer.
- **`lib/seo.ts` AUTHORED** (demo had none to port despite §9's "port" wording
  — no seo.ts existed in the redesign demo): buildSeo/formatPageTitle/
  summarizeText/toAbsoluteUrl/schemas/PRIVATE_ROUTE_HEADERS, greenfield
  buildSeo-only shape.
- **`useEventStream` uses one `useEffect`** — sanctioned: syncing an EXTERNAL
  push source (EventSource) into the Query cache is the effect use-case §9
  permits; the list itself stays a cache read.
- **Web reads db via dynamic import inside server-function handlers**
  (`#/lib/server/db`) so pg never enters the client bundle.

### Step 5 — Rules registry

- **AUTHORED — morning review target: `RuleResult` envelope**
  (contracts/rules.ts) per §4/§6: `{ruleId, version, status:
  evaluated|skipped, passed, evidence, reason?, evaluatedAt}`. `passed:false`
  whenever skipped; `reason` present iff skipped. Config-parse failure and
  evidence-schema failure both produce skipped results, never throws.
- **`zod` added to @tripwire/core** — §6 mandates Zod config + result schemas
  per rule; the §3 arrow note says "imports contracts + utils only", which
  reads as @tripwire/* package arrows (contracts itself imports zod). Boundary
  script unaffected.
- **`fast-check` (dev) added to core** — named explicitly by §11's property
  test row.
- **RuleContext shapes live in core/context.ts**, structurally compatible with
  forge's read types; the worker maps adapter output → context. Duplication is
  the price of "nothing imports core except worker" + "core never imports
  forge". Clock (`now`) is a context INPUT — rules are deterministic.
- **Old prod repo not on disk** — all 8 rules are fresh implementations from
  the spec's names/semantics (§13.5 sanctions "fresh implementations"; the old
  repo was reference-only and is unavailable). Judgment calls per rule:
  · pr-rate-limit: window count gates; interval CoV (spray signature) is
    evidence-only. · english-only: non-Latin letter ratio ≥ threshold on
    title/comment; <4 letters ⇒ skipped. · crypto-address: conservative
    eth/btc/sol format regexes over title+comment+diff. · honeypot: glob-lite
    (`*` segment, `**` spans) with no dependency. · profile-readme: min
    profile-text length.
- **Rule unit fixtures:** the event half of every fixture context is a
  CAPTURED payload run once through the real normalizer and stored under
  `packages/core/fixtures/` (core cannot import the adapter). Contributor/diff
  halves are per-test inputs — flagged for replacement by captured API
  responses once the App is live (queue #3 note).
- **evaluateRule is async** so ai-review's injected `generate()` (step 9)
  composes without churn.

### Step 6 — Executor + hardcoded workflow

- **AUTHORED — morning review target: `contracts/workflow.ts`** from §6. DAG
  semantics decided here: edges conduct on the source outcome (`when:
  pass|fail`, default pass); `approve`/`deny` edges only leave
  send-to-moderation nodes and only conduct on resume; a node runs when ≥1
  incoming edge conducts. **Skipped rules conduct as pass** — a rule that
  can't evaluate must not block (§6 purity); the skip is still recorded.
- **Verdict derivation:** paused ⇒ needs_review; any conducted `block` action
  ⇒ block; else pass. Multi-workflow JOIN takes the worst verdict
  (block > needs_review > pass); step nodeIds are prefixed `wfId:` to keep
  them unique inside the joined run.
- **Resume model:** run_steps persist node outcomes; resume re-walks with the
  stored outcome memo + the decision, executing only the decision edge's
  downstream. Deterministic, no context re-fetch.
- **Executor takes an injected `evaluateRuleRef`** rather than touching the
  registry — worker composes registry + context + (later) generate().
- **Maintainer/org-member exemption (§6)** applied at run level: exempt actor
  ⇒ no run at all (no gate, no comment, no check). Alternative (run-but-pass)
  rejected: gating maintainers' own repos is noise.
- **Rule throw = bug (§6)**: worker catches, logs error, records skipped with
  the message — one bug degrades one rule, never the run.
- **Default workflow** (worker/default-workflow.ts): CR opened/updated →
  account-age(7d) + crypto-address + honeypot(.github/workflows/**) +
  max-files-changed(200) + english-only(0.5) → all-of gate → block on fail.
  Validated at module load.
- **GithubReads** implements the §4 read surface with plain fetch (no
  octokit); contributor profile composes /users, merged-PR search, recent-PR
  search (timestamps for CoV), collaborator permission, profile README.
  Every read degrades independently to a null context piece.

### Step 7 — Actions + the PR surface

- **`block` executes no forge call of its own** — the failing `tripwire`
  check IS the block (§7: required status ⇒ dead merge button). Closing PRs
  is deliberately not tripwire's job. The block action still exists as a
  workflow node/verdict carrier and is recorded/executed as a row.
- **Comment/check idempotency keys carry the verdict**
  (`comment:<nr>:<verdict>`, `check:<sha>:<verdict>`): a retry of the same
  verdict conflicts (no double call), while a moderation resume with a NEW
  verdict inserts fresh rows and re-edits/re-emits. Cross-run artifact
  identity stays with the adapter's upsert (marker / check_name+sha).
- **Comment presenter is structurally condensed:** verdict line + one
  collapsed sentence + one shields badge + hidden marker — 3 lines, snapshot-
  golden. Copy follows constitution.md (blocked/passed/sent to review,
  lowercase, no exclamation).
- **Pending check (§5.6b) is executed directly, not recorded as a run action
  row** — it precedes the run's existence (rows FK run_id); the final check
  from the persistence step supersedes it.
- **`request-review` executes with an empty reviewer payload for now** —
  reviewer selection is a params question for the workflow editor (step 10);
  GitHub then falls back to suggested reviewers or errors harmlessly (caught,
  row stays recorded).
- **GithubHttp** extracted (get/post/patch/put; used by reads AND actions —
  the 2+ consumer bar).

### Step 8 — Run page + rules UI + auth

- **Dep added: `better-auth`** — §2-locked choice. Instance factory
  `createAuth` lives in `@tripwire/db` (auth is database-backed; db is the one
  package all three heads may import). The api head mounts the HTTP handler at
  `/api/auth/*`; the web head instantiates the SAME config for session reads —
  stateless instances over one database.
- **`/api/auth` is vite-proxied to the api head** so cookies stay same-origin
  in dev; at deploy the reverse proxy (Caddy, per §13 deploy note) does the
  same. Keeps "NO internal REST" intact — auth is Better Auth's own protocol
  surface, not dashboard data.
- **Auth gate stands OPEN when `BETTER_AUTH_SECRET` is unset** (root
  beforeLoad checks `authEnabled`). Local dev before the OAuth app exists
  stays usable; the queue item closes it. Logged prominently.
- **forge_identities row created via Better Auth databaseHook** on github
  account creation (§10: identity in exactly two places).
- **Rule config schemas moved to `contracts/rules.ts`** + `RULE_CATALOG`
  (AUTHORED — morning review target): rule config crosses UI → jsonb → worker
  boundaries, which is contracts' definition. Core imports its config schemas
  from contracts now (single source); evidence schemas stay in core. The
  catalog carries UI names/blurbs/defaults; the registry stays engine truth.
- **Rules UI edits config as validated JSON** (textarea + zod safeParse server-
  side and client-side error surfacing) — boring; per-field forms can come
  with the editor work. `dep added: none` (uses existing demo primitives).
- **Run page** renders run_steps evidence raw (`EvidenceView` JSON) — §6
  "evidence makes the run page real"; ai-findings.tsx arrives with step 9.
- **`getStartContext().request`** is how server functions read headers in
  this @tanstack/react-start version (dep `@tanstack/start-storage-context`
  pinned to the workspace's existing transitive version).

### Step 9 — ai-review

- **`~/tripwire-eve-demo` DOES NOT EXIST on this machine** — the §8 "port the
  review process from the eve demo" input is missing. instructions.md,
  template.md, and the tool flow are AUTHORED fresh from §8's locked
  decisions. **MORNING REVIEW TARGET #1** — if the demo lives elsewhere,
  point a rework session at it; a material prompt change is `ai-review@2` by
  the versioning law.
- **Deps added:** `ai` + `@ai-sdk/anthropic` (worker — §2-locked "AI SDK,
  Anthropic provider first"), `zod` (worker, tool input schemas).
- **Injection shape:** `RuleContext.generate?: AiReviewGenerate` — matches the
  scoped agents.md wording ("effects arrive injected via RuleContext /
  generate()"). Core defines the TYPE; the worker's `createGenerate` wraps
  the AI SDK. Core never imports the AI SDK or the adapter.
- **Structured output via a `submit_review` tool** whose input schema IS
  `aiReviewOutputSchema`; `stopWhen: [stepCountIs(cap), hasToolCall]`. Chosen
  over experimental output modes: the tool call is the muzzle, validation
  happens twice (SDK input schema + rule safeParse). Schema-violating output
  ⇒ skipped, never a throw.
- **Verdict → boolean:** passed iff verdict === "pass"; block AND needs_review
  both fail the boolean requirement. Workflow routing to moderation keys off
  the workflow's own send-to-moderation node, not the rule verdict — the §8
  composition example works by wiring ai-review's fail edge into a gate.
- **Prompt files imported as compile-time text** (`with { type: "text" }`,
  Bun-native) — no runtime I/O in core; md.d.ts ambient declaration included
  by worker's tsconfig (the only legal importer of core).
- **ai-review added to the default workflow** (skips harmlessly without
  ANTHROPIC_API_KEY). Diff char budget 60k up front.
- **Trace persistence:** evidence = { output, trace: {model, steps, usage,
  finishReason} } — "show me why" on appeal + the future dataset.
