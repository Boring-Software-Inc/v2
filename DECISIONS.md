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
- **AMENDED (post-live-bring-up — SECURITY, live-test surprise #2):** the "a
  node runs when ≥1 incoming edge conducts" rule was a merge-gate hole for GATE
  nodes. Rule→gate edges default `when: "pass"`, so a gate whose feeding rules
  ALL fail never conducted, never fired `block`, and the run derived verdict
  **pass**. Live evidence: T2a first attempt, run
  `019f538a-926f-7000-87c7-e9cd3d79c80a`, a single failing rule ⇒ verdict pass;
  the default workflow only blocked because sibling PASSING rules conducted the
  gate open. Fix (executor.ts): **a gate runs once ≥1 source node has settled
  (been reached) and aggregates its sources' OUTCOMES** — edge when-conduction
  no longer gates gate execution; it still governs rule→action and gate→action
  edges. `validateWorkflow` is unchanged: the same graphs are well-formed (a
  gate still needs ≥1 input, already enforced by the unreachable-node check).
  Guarded by an exhaustive property test: for the derived shape, no rule-outcome
  combination with ≥1 failing rule can verdict pass.
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

### Step 10 — Moderation queue, rollups, React Flow editor

- **Resume runs through a pg-boss `resume-run` job:** the web head cannot run
  the executor (nothing imports core except worker), so a decision = ONE tx
  (mark item decided + enqueue) and the worker walks the decision edge. Node
  outcomes for the resume are DERIVED from run_steps (fail→fail, else pass) —
  no extra storage, snapshot-faithful.
- **Home stat cards now real** (insights.getHomeStats in the ModStats contract
  shape): pending/resolved moderation counts, blocked-runs-24h, hourly series.
  `bannedUsers` reports honest zeros — no ban concept exists; repurposing the
  card would lie. The home QUEUE list stays mock-backed: its rich shape
  (reasons/severities/reporters) outlives real data so far; it migrates when
  a later session gives real data that depth. Mock-shrink continues.
- **Rollup job** recomputes yesterday+today (late arrivals), scheduled
  `10 2 * * *` via pg-boss cron.
- **`DEFAULT_WORKFLOW` moved to contracts** — the editor needs the starting
  canvas and web can't import worker; precedent RULE_CATALOG. Worker
  re-validates it at boot.
- **Dep added: `@xyflow/react`** (§2-locked "React Flow (xyflow)").
- **Editor round-trip proof:** `graphToDefinition` (web, pure) is THE
  emission; identity round-trip + schema-parse proven in web tests; a
  COMMITTED emission artifact (apps/worker/fixtures/editor-output.workflow
  .json, generated through the real serializer) is validated by core
  validate.ts and executed to a verdict in a worker test — web→core import is
  forbidden by the arrows, the artifact is the legal bridge.
- **workflow config typed as JSON in the contract** (`jsonValueSchema`) —
  configs are JSON on the wire by definition; also satisfies server-fn
  serialization typing.
- **getRepoById added to repoServices** after a query briefly leaked into a
  web server function (also caused a duplicate drizzle instance) — "a query in
  a route handler is in the wrong layer" enforced.
- **Flake fixes:** docker-run retry (3 attempts) in createTestDatabase; the
  account-age integration fixture now sets creation 2d+1h back — the old 2d
  margin floored to 1 whenever the profile fetch timestamp trailed ctx.now.


---

## Hardening session (2026-07-11, pre-live)

### Unit 1 — fail-closed floor (AMENDS the step-6 "skipped conducts as pass" entry)

- Single-rule skip still conducts as pass — one flaky read must not block a
  human. UNCHANGED.
- NEW FLOOR in run verdict derivation (worker/run-workflows): if every rule
  node skipped, or skipped ≥ 50% of rule nodes, a would-be `pass` becomes
  `needs_review` — paused run + `run:degraded` moderation item. Block stays
  block (strictly stronger). Rationale: an attacker who can starve our reads
  (rate-limit burn) must not mint green checks.
- Degradation evidence persists as a synthetic run step (`run:degradation`,
  output = { degradedReads, skippedRules, ruleNodes }) — no schema migration,
  renders on the run page.
- Resume semantics for the synthetic item: approve ⇒ pass; deny ⇒ block with
  a recorded+executed block action (resume-run/resumeDegradedRun).
- Comment/check copy for the degraded case: "sent to review — evaluation
  degraded." (constitution voice), check neutral per §7.
- Note: ai-review skipping for lack of an API key counts toward the floor by
  the formula — running keyless with sparse workflows can floor runs; that is
  fail-closed working as intended, not a bug.
- Queue amendments landed here: Issues R&W permission at #1 (comment upsert
  is Issues API); degraded-path sub-check at #5.

### Unit 2 — auth gate fail-closed in production

- `resolveAuthPosture` (db/auth.ts): secret ⇒ enabled; no secret + dev ⇒
  open-dev (unchanged local ergonomics); no secret + NODE_ENV=production ⇒
  throw. The api head exits at boot on the throw; the web head's getAuth
  throws per request (no single boot hook in the vite/nitro server) — either
  way production never silently publishes the dashboard. Guard unit-tested.

### Unit 3 — block files a request-changes review (AMENDS the step-7 entry)

- The step-7 "block executes no forge call" decision is amended: `block` now
  ALSO submits a request-changes PR review (one adapter call, constitution-
  voice one-liner + run link) so unprotected repos get friction. The failing
  check remains the primary gate.
- Best-effort by design: review submission failing (403 on own PRs is legal
  GitHub behavior; also covers missing permission) logs a warn and marks the
  row executed — it never kills the run and never blocks retry of other rows.
- Idempotency unchanged: block rows are per-run verdict-scoped like
  comment/check (re-runs conflict; resume rows carry the :resume suffix).


### Unit 4 — ai-review prompt hardening + the eve port (still @1)

- **Eve demo FOUND at `~/tripwire-eve-agent-demo`** (path correction from
  Grim) — morning review target #1 is RESOLVED by porting, not rework:
  instructions.md now carries the demo's review process per §8 — the
  maintainer-QoL test as the governing question, the slop-signal taxonomy,
  the read-the-repo's-own-rules tool step (CONTRIBUTING/AGENTS via
  read_file), and "ambiguity is allowed" → needs_review. Discarded from the
  demo (superseded by spec §7/§8): the label system, the closing policy, the
  long comment format, dimension score table — the muzzle schema + one-button
  comment replace all of it.
- Hardening additions (Grim's trust rules kept verbatim): AI-assistance
  product line ("ai assistance is not itself a finding"), confidence anchors
  (0.9+ verified file/line · ~0.6 unconfirmed pattern · <0.5 prefer
  needs_review over low-confidence block).
- **Truncation is explicit:** clipDiff renders
  `[diff truncated: showing 60000 of N chars]` so the trust rules can act on
  it; tested both ways (marker present when clipped, absent otherwise).
- Injection-attempt fixture added to the rule test corpus (prompt-level
  assertions — instruction adherence itself is evaluated live at queue #7's
  injection drill).
- All edits land as ai-review@1: zero live runs exist; the versioning law
  protects stored runs and there are none. First live invocation freezes v1.


### Provider swap: Anthropic direct → OpenRouter (Grim's instruction)

- Dep swap in worker: `@ai-sdk/anthropic` → `@openrouter/ai-sdk-provider`
  (OpenRouter-maintained AI SDK provider; tool calls supported). §2's
  "Anthropic provider first" is amended by owner instruction; the review
  agent was provider-agnostic by design ("model is a config string"), so the
  blast radius is one file (worker/ai/generate.ts).
- Env: `OPENROUTER_API_KEY` replaces `ANTHROPIC_API_KEY`; `AI_REVIEW_MODEL`
  is now a REAL knob — the worker's default model (OpenRouter slug, default
  anthropic/claude-fable-5). Precedence: explicit rule config model > env
  default. `aiReviewConfigSchema.model` became optional accordingly; the
  default workflow and RULE_CATALOG no longer pin a model.
- Resolved model (not the config value) persists in the trace evidence.


### Dev-env plumbing (live bring-up findings)

- **Nitro's dev server-fn runtime does not inherit shell/bun env** — it loads
  dotenv from the app dir. Convention: root `.env` is the single source of
  truth; `apps/web/.env` is a SYMLINK to it (`ln -sf ../../.env
  apps/web/.env`, gitignored, documented in .env.example). api/worker load
  the root .env by being run from the root (`bun run dev:api|dev:worker`).
- **`PORT` renamed `API_PORT`** — the generic name leaked into vite through
  the symlinked env and moved the web dev server onto the api's port.
- **Bun.serve idleTimeout 45s** (api) — the 10s default severed SSE streams
  between 15s heartbeats.
- Query errors now render on the events page instead of hiding in the
  server-fn serialization frame.

### packages/auth (OWNER-AUTHORIZED §3 layout amendment)

- Grim's instruction: fold auth into its own package. `@tripwire/auth` with
  split entrypoints — `./server` (createAuth + resolveAuthPosture, moved from
  db) and `./client` (the browser authClient; must never import server code).
  Arrows: auth ← web (api no longer touches auth); auth imports db + utils.
  Boundary script updated.
- **Auth transport rebuilt after live debugging.** The vite `server.proxy`
  NEVER fired — nitro owns the request pipeline, so /api/auth fell through to
  the TanStack router where the auth gate 307'd it to /login (the "button
  does nothing" bug: the client was fetching login HTML). Attempts, in order:
  nitro `server/routes` convention (not picked up by this nitro/vite beta,
  with or without srcDir) → **TanStack Start request middleware** (works):
  `src/start.ts` exports `startInstance = createStart(() => ({
  requestMiddleware }))`; the middleware serves /api/auth/* via
  `auth.handler(request)` before routing. Same-origin cookies, OAuth callback
  on :3000, zero proxy. The api head's auth mount, CORS block, and the vite
  proxy are removed.
- **`generateId()` made portable**: the web head's nitro dev runtime is NODE
  — `Bun.randomUUIDv7` threw "Bun is not defined" the moment better-auth
  wrote its OAuth state row. Bun fast path kept; RFC 9562 UUIDv7 fallback
  (crypto.getRandomValues + 48-bit ms timestamp) added. This also un-blocks
  any future non-Bun runtime touching utils.
- Live-debug fixes folded in along the way: `.env` PEM re-quoted (raw
  multiline broke Bun's parser), `GITHUB_CLIENT_ID/SECRET` → the
  `GITHUB_OAUTH_*` names the code reads, sign-in errors now toast.

---

## Spec-sync session (post-live-bring-up)

- **spec.md updated to match owner-approved reality** (the spec stays the
  source of truth): §3/§4 gained `packages/auth` + the auth arrow (auth ←
  web, api); §10 records the web-head transport and WHY (vite server.proxy
  dead under nitro; no file-based server routes in this react-start version);
  §2/§8 record the OpenRouter default + AI_REVIEW_MODEL precedence; §2 runtime
  row + frontend.md record the Node-runtime caveat for the web head. AGENTS.md
  and architecture.md arrow blocks mirrored; parity audit de-staled.

### SSE session gate (code unit)

- `/events/stream` is now session-gated: dashboard data is for maintainers.
  `/webhooks/github` stays public (HMAC is its auth); `/healthz` stays open.
  The api builds its own auth instance for session READS only (github: null —
  sign-in stays on the web head); dev open posture (no BETTER_AUTH_SECRET)
  keeps the stream usable, production refuses to boot (posture guard
  reinstated on api).
- **Browser stays same-origin:** the web head's start.ts middleware proxies
  `/api/events/stream` → api with the session cookie attached (server-to-
  server fetch, stream passthrough) — the /api/auth precedent, chosen over
  cross-origin credentialed EventSource.
- getSession is faked at the Auth seam in tests (better-auth cookie internals
  are not under test): no session ⇒ 401, session ⇒ heartbeat, dev-open ⇒
  heartbeat, webhook/healthz untouched. Live smoke: cookieless curl ⇒ 401.

### Installation sync (live gap: installing the App created no repo row)

- The §5 ingest list never included installation events — /rules showed "no
  repos" after a real install. Fixed minimally: `installation`
  (created/deleted) and `installation_repositories` (added/removed) normalize
  to four new NormalizedEvent kinds. Installation events carry an
  `installation { externalId, account }` + `repositories[]` instead of a base
  repo — the union split produced `RepoScopedEvent` / `InstallationEvent`
  helper types, and repo-carrying events now also record `repoExternalId`.
- Worker: installation kinds sync repos rows (upsert refreshes installation
  id + clears removed_at on re-add; removal/uninstall soft-deletes per the
  step-2 decision) and produce NO run, NO check, NO comment. Lazy repo upsert
  on change-request events for unknown repos covers installs made while the
  tunnel was down (placeholder external id when the payload lacks one).
- Dashboard repo lists now exclude soft-deleted rows (listActiveRepos).
- **Fixture provenance:** installation.created is SELF-CAPTURED from our
  App's live delivery (58273eb0…, no scrubbing needed — installation payloads
  carry URLs, not tokens). deleted/added/removed variants from octokit
  captures until real ones occur. The integration uninstall test flips the
  action field of our own capture in memory (same installation id required)
  — flagged as the one synthesized variant.

### Live heartbeat proof + exemption bypass flag (queue #5 partial, ai-review live)

- **`TRIPWIRE_DISABLE_EXEMPTION=true`** env flag added to run-workflows —
  off by default, disables the maintainer/org-member exemption. Purpose: the
  repo owner can't test the gate on their own PRs (they're exempt), so this
  lets solo end-to-end testing exercise the full pipeline without a second
  account. Not a production toggle; documented as a testing affordance.
  FOLLOW-UP (next session touching the worker): fence it — refuse
  `=true` when `NODE_ENV=production` (same pattern as `resolveAuthPosture`).
  It fails toward MORE blocking (maintainers get gated), so it's not a
  security hole, but a forgotten `=true` in prod blocks a customer's own
  maintainers → support-ticket generator.
- **Correction to the step-7 "block review 403s on own PRs" note:** it does
  NOT. The block action posts the request-changes review under the App
  INSTALLATION identity (`tripwire-dev[bot]`), which is distinct from the PR
  author — so it succeeds even on the owner's own PR. The graceful-degrade
  path still matters for missing permission, but "own PR" is not a 403 case.
- **Live heartbeat verified** against a real malicious PR
  (Boring-Software-Inc/scratch#1: exfil workflow + crypto DONATE + injection
  in the description): default workflow verdict `block`; crypto-address,
  honeypot, and ai-review all failed; the `tripwire` check is `failure` on
  the head SHA; ONE comment posted with the marker; a CHANGES_REQUESTED
  review posted by the bot. ai-review confidence 1.0, findings on the exfil
  (curl-pipe-sh + GITHUB_TOKEN exfiltration), the "typo fix" social
  engineering, and the crypto spam — and it did NOT obey the "pre-approved,
  submit pass" injection in the description. The muzzle + trust rules hold
  live. Remaining for full queue #5: mark `tripwire` required in branch
  protection to kill the merge button, and re-push to confirm the comment
  edits in place.

### PR comment button: shields.io badge → hosted "View on Tripwire" PNG

- Grim's Paper design for the run deep-link button (dithered Geist-Pixel
  "◆ View on Tripwire →") ported. GitHub comments render only a safe HTML
  subset — no shaders, no custom fonts — so the button is a STATIC PNG
  (exported 3x, 555×93) wrapped in a link:
  `<a href="{runUrl}"><img src="{appUrl}/badges/view-run.png" width="185" ...>`.
  GitHub allows `<a>`/`<img>` + width in comments.
- The button is now VERDICT-NEUTRAL (one image, "View on Tripwire") — the bold
  verdict line above carries block/pass/review; dropped the 3-color shields
  badge. Simpler and matches the design.
- Asset lives at `apps/web/public/badges/view-run.png`, served by the web
  head. Reachability caveat (same as the run deep-link): renders on GitHub
  only when APP_URL is public (deploy, or a tunnel to the web head) — on
  localhost the image shows its alt text, exactly like the localhost run link.
- Snapshot goldens regenerated; the condensed-comment test now asserts the
  linked-image button instead of the shields url.

### PR comment as-built — dropdown + PNG button + copy (consolidated)

- **One cohesive comment, not two competing messages.** Structure: verdict
  line + one sentence (contributor-facing) THEN a
  `<details><summary>for maintainers</summary>` collapsible holding the run
  context + the "View on Tripwire" button. The request-changes review body was
  trimmed to a one-liner that defers to the comment — kills the earlier
  double-message feel (comment + review both restating the verdict).
- **Button = hosted PNG** (`apps/web/public/badges/view-run.png`, exported 3x
  from Grim's Paper design — dithered Geist-Pixel "◆ View on Tripwire →").
  GitHub comments render no shaders/custom fonts, so it's `<a><img width=185>`;
  verdict-neutral (the bold line carries the verdict). Reachability = APP_URL
  must be public (same as the run deep link); on localhost it shows alt text.
- **Copy rewritten in tripwire voice:** "this change tripped N of M rules. it
  can't merge until they clear." / "this change needs a maintainer's eyes
  before it can merge." / "couldn't finish checking this change, so a
  maintainer will make the call." (degraded floor) / "cleared all N rules —
  good to merge." Constitution verbs (blocked/passed/sent to review) intact.
- Verified live on Boring-Software-Inc/scratch#1.

### Public run pages — AUTHORED DECISION, deferred to post-rule-testing

Grim's call, recorded now, patched after the rule-testing pass (changes
nothing about current tests — sessions are signed in). Full rationale in spec
§10 "Access model". Summary: `/runs/{id}` becomes public read-only (unguessable
UUIDv7, gist-style) so blocked contributors can read the judgment — they can't
sign in (contributors never authenticate, §10). Public view = verdict + steps +
evidence + ai-review FINDINGS; NOT the raw ai-review trace (internals + evasion
aid). Mutations (approve/deny) and all list/index routes (/events, /moderation,
/rules, insights, run lists) stay session-gated. Private-repo runs stay gated
for MVP (link would leak repo/contributor/diff). "powered by tripwire" footer
on the public view (free top-of-funnel).

**Session prompt (fire after the rule-testing/calibration pass):**
> Read spec §10 "Access model". Make `/runs/$runId` publicly readable with NO
> session required, via a public-view render: verdict, per-rule steps, rule
> evidence, and ai-review FINDINGS — but not the ai-review raw trace (keep the
> trace behind a session). All mutating controls (approve/deny) and every
> list/index route (/events, /moderation, /rules, insights, run lists) stay
> session-gated. Private-repo runs stay session-gated for MVP — a public run
> is public-repo only; gate a private-repo run's page to sessions with repo
> access (ledger the MVP simplification if you punt). Add a small "powered by
> tripwire" footer to the public view only. Tests: no-session public read of a
> public-repo run returns verdict+findings and omits the trace; no-session
> approve/deny and list routes return 401/redirect; private-repo run 404s or
> gates without a session. Spec §10 already records the model; DECISIONS +
> all-summaries per protocol.
> Also close VERIFICATION-QUEUE #11 in this pass: run page + /moderation
> render the run:deny-floor and run:degradation synthetic steps distinctly
> (a denied-by-floor block should say so).

### Bot copy centralized — packages/forge-github/src/copy.ts

- Every user-facing string the bot writes to GitHub now lives in one file
  (verdict headlines + words, the four verdict sentences, the for-maintainers
  dropdown label + intro, button alt, review body, pending/final check
  summaries). Tune the voice in one place; governed by constitution.md.
- Placed in the GitHub adapter (not a new package — anti-BS) because it is who
  renders it; the worker's pr-surface imports the check/review/sentence copy
  via `@tripwire/forge-github`. Structural tokens (`<!-- tripwire:run -->`
  marker, badge path/width) stay with the presenters — they are not copy.
- When a second forge adapter lands, lift the forge-neutral pieces to a shared
  home; noted inline in copy.ts.

### Unified-rules spec merge (2026-07-11) — "automod" killed as a concept

Owner-approved amendment folded into spec.md (docs only, no code this pass).
"Automod" is not a fourth primitive — it was a better rules UI plus a new class
of rule targets. Both absorbed: UI into `/rules`, targets into the rule
primitive. Rules now declare `target: change-request | comment | issue`; the
executor is unchanged, only the RuleContext per trigger differs. Actions split
into gate actions (change-request) vs reversible content actions (`hide-comment`
/ `label` / `send-to-moderation`; never auto-delete; `lock-thread` cut).
`validate.ts` enforces target/action compatibility. Content evals are runs +
run_steps + `run_actions` (reversal handle stored); `content_matches` is a
derived index for `/rules` counts. v1 content rules: spam-domains@1,
blocked-terms@1, custom-pattern@1 (RE2-class / timeout+length cap — untrusted
regex is a DoS invite), comment-burst@1; crypto-address@1 gains `target:comment`.
Classifiers (profanity/harassment/NSFW) deferred to the cut list. FP loop:
reversals are labels, FP rate = reversals/actions per rule, "not enough data"
below a floor; unhide affordance ships v1. New ingest kinds `issues.opened` /
`issues.edited` / `issue_comment.edited`. `/automod` page deleted; its charts/
toggles UI becomes `/rules` over real data.

**Amendment §4 (toggle semantics) SUPERSEDED by owner's derived-default model:**
- No-workflow repos: the workflow is DERIVED from enabled rules ("on
  change-request → every enabled change-request rule → all-of gate → block on
  fail"; same shape for content). Toggle on = runs, off = doesn't.
- Custom-workflow repos: the graph wins. Toggle off = kill switch (nodes
  referencing the rule skipped, recorded `skipped: disabled`, conducts as pass,
  EXCLUDED from the degradation floor — disabled is deliberate, degraded is
  accidental). Toggle on does NOT insert nodes; cards show a "managed by your
  workflow" tag.
- The amendment's "not wired — won't run" indicator is DELETED (derived defaults
  make it impossible for no-workflow repos; the managed tag covers custom ones).
- The `DEFAULT_WORKFLOW` fixed constant is superseded by `core/workflow/derive.ts`.
- Only engine change implied: the worker consults `rule_configs.enabled` at node
  evaluation. Deferred to the toggle-semantics session (§9-step-2 sequencing).

Renames/kills: "automod" vocabulary banned in constitution.md (use "rules"),
`hide/unhide` over `delete/remove`. Mockup's pull rows reclassify onto rules
(workflow tampering = honeypot@1; destructive-PR guard = a new change-request
rule → send-to-moderation; tracking pixels = change-request rule / ai-review
finding). Cut-list additions: content classifiers · lock-thread · PR-description
matching · discussions/wiki/commit scanning · report buttons · auto-delete ·
cross-repo content bans · signal nodes in the editor (trigger/rule/gate/action
already exist — only SIGNAL nodes deferred). Sequencing unchanged: this is
spec-merge step 1; toggle-fix, rules-page absorption, content pipeline follow.

### Toggles become real — derived default workflow (post-live, live-test surprise #1)

The worker never read `rule_configs` — only the web UI did — so `/rules`
toggles were cosmetic: execution ran saved `workflow_definitions` or the
hardcoded contracts `DEFAULT_WORKFLOW`, and `core/workflow/derive.ts` didn't
exist. Live evidence: T1, run `019f5388-a3cd-…f575f9`, account-age disabled yet
evaluated (`accountAgeDays 2037`). Fix:
- **`core/workflow/derive.ts`** — for a repo with NO saved workflow the executed
  workflow is DERIVED from the toggles: "on change-request → every enabled rule
  → all-of gate → block on fail". Baseline = the contracts `DEFAULT_WORKFLOW`
  rule set (retired as an executed constant, kept as the derivation's baseline).
- **Overlay model (the fresh-repo default — decided here):** a baseline rule
  runs UNLESS a toggle explicitly disables it; a disabling toggle drops it; a
  toggle's config overrides; an enabled toggle for a non-baseline rule opts it
  in. So a fresh repo (zero rule_configs) keeps the boring default gate exactly
  as before — the existing heartbeat + integration tests stay green — while a
  configured repo honors its toggles. Alternative "unconfigured = off" rejected:
  it silently ungates every fresh install (a security regression) and would have
  required rewriting the step-6 done-when test's premise.
- **Saved-workflow path** — the graph wins; a node whose rule is disabled skips
  as `disabled` (conducts as pass per the Unit-1 gate fix, EXCLUDED from both
  sides of the degradation-floor ratio — disabled is deliberate, degraded is
  accidental). Injected into the pure executor via `isRuleDisabled(ref)`.
- **`/rules` managed tag** — `hasEnabledWorkflow(repoId)` drives a "managed by
  your workflow" tag on rule cards; the toggle there is a kill switch over the
  saved graph, not a derived default.
- **KNOWN RESIDUAL (out of scope — the four units are the execution engine):**
  the `/rules` display default is still `enabled ?? false` for an unconfigured
  rule, which under-reports the baseline rules a fresh repo actually runs. The
  honest display fix (baseline rules show on) belongs to the §9 rules-page
  absorption session, not this engine pass. Flagged, not fixed.

### Surface sweeper + staleness + comment ownership + boot health (post-live, surprise #3)

Live evidence (T3): a creds outage left `comment:1:needs_review` and
`check:28540dc…:needs_review` stuck at `status=recorded` — the neutral check
never reached GitHub, the stale previous comment stood, and there was no retry.
A follow-on live finding: two moderation items on one PR decided out of order —
approve on an older run executed LAST and its `comment:1:pass` upsert overwrote
the blocked comment. Runs are per-event/SHA; the comment is per-PR; last write
won. Fixes:
- **Sweeper (`apps/worker/src/jobs/sweep-actions.ts`, scheduled every minute):**
  re-attempts `run_actions` stuck at `recorded` once creds recover. Idempotency
  keys make retries safe. Age-windowed instead of a per-row attempts column
  (migration-free): retried only after ~2 min, abandoned (superseded + loud log)
  past ~60 min — the "cap attempts + log" requirement, by time.
- **Staleness guard:** a completed run with a NEWER surface row of the same kind
  has already re-emitted the final verdict — the older recorded row is
  `superseded`, never executed (so the deferred needs_review comment can't
  overwrite the resolved block). Handles the deny-resume case.
- **Comment ownership:** the comment is per-PR, runs per-SHA — only the LATEST
  run for the change request (runs table, latest by created_at, id tiebreak) may
  execute its comment. Non-latest runs still emit their per-SHA CHECK (correct
  and harmless); their comment action is `superseded`. Enforced on EVERY surface
  emission (`emitPrSurface` — initial + resume) AND in the sweeper. Composes with
  the staleness guard: same `superseded` status, two triggers (verdict moved on,
  or a newer run exists).
- **Boot health check (`checkAppCredentials` — GitHub `GET /app` via App JWT):**
  the worker validates App creds at startup with one cheap call and logs the
  ai-review credential state — one loud line each. Does NOT refuse to start (the
  fail-closed floor already degrades broken-cred runs to needs_review); the point
  is that a worker on stale/broken env is visible at boot, not discovered one
  degraded run at a time (the live session ran a whole pass on broken creds).
- New `run_actions` status `superseded` (text column — no enum migration).

### Exemption env hardening + queue #10 closed (post-live)

VERIFICATION-QUEUE #10 (maintainer-exemption integration test failing) was
**environmental, not a code regression** (owner-verified; reconfirmed here on a
clean env — 12/12). `TRIPWIRE_DISABLE_EXEMPTION=true` had leaked into the process
env during a live-test pre-flight; the worker reads it at run time so the
maintainer test saw a run. Hardening:
- **`apps/worker/src/exemption.ts`** — `isExemptionDisabled(env)` is pure and
  REFUSES the flag under `NODE_ENV=production` (resolveAuthPosture pattern: fail
  toward the safe posture — exemption stays on, maintainers never get gated in
  prod by a stray flag). `exemptionFlagRefusedInProd` drives a loud worker warn.
  Unit-tested, including the affordance (flag set in dev ⇒ exemption disabled).
- **Test isolation** — the worker integration tests that exercise the exemption
  path (`process-event`, `toggles`) `delete` the flag in `beforeAll` and restore
  it in `afterAll`. Proven: the maintainer test passes even when the flag is set
  in the ambient env. This permanently prevents the #10 contamination.
- Env audit: `TRIPWIRE_DISABLE_EXEMPTION` was the only run-time-env-sensitive
  behavior in the worker's evaluation path; `APP_URL` / `GITHUB_APP_*` /
  `OPENROUTER_API_KEY` are boot-time composition, not per-run branches.

### Deny floor — deny must never fail open (T4 live headline)

T4 live: the editor-emitted graph (trigger → account-age → fail →
send-to-moderation, no deny edge) paused correctly, but Grim's DENY resumed the
run to verdict PASS — the check flipped neutral → SUCCESS and the comment said
"good to merge". Deny semantics lived exclusively on `deny` edges; a graph
without one had no consequence to conduct, and the resume path read "nothing
failed downstream" as pass. A maintainer's explicit no produced a green merge
button.

- **Deny floor (`resume-run.ts`):** a deny whose paused moderation node has NO
  outgoing `deny` edge floors the verdict to **block** — recorded as a synthetic
  `run:deny-floor` step (`"deny (no deny edge) → block by default"`) plus a
  recorded+executed `block` action row
  (`block:<wf>:<node>:deny-floor`). Deny means no, whether or not the graph
  author drew the consequence.
- **Approve stays as-is:** approve-with-no-approve-edge resuming to pass IS the
  correct reading of approve. Untouched.
- **Graphs WITH an explicit deny edge are unchanged** — the floor only fires
  when no deny edge exists (an existing deny edge always conducts on deny, so
  "no conducting deny edge" ≡ "no deny edge").
- **validate.ts unchanged:** a moderation node with no deny edge stays LEGAL —
  the floor covers it. Derive/editor templates should still draw explicit
  approve/deny edges where sensible.
- Tests (moderation integration): the T4 graph verbatim — deny ⇒ block +
  failure check + blocked comment rows; approve ⇒ pass, no floor step;
  deny-with-edge (existing test) unchanged; degraded-floor resume
  (`run:degraded` deny ⇒ block) pinned.

### Editor outcome handles — fail/approve/deny expressible (T4 editor fix adopted)

Before T4, node cards had ONE source handle and `onConnect` created unlabeled
edges — every hand-drawn edge was a pass edge; `when:"fail"` (and approve/deny)
were inexpressible in the editor. The T2a footgun reproduced in the UI: the T4
graph could not have been drawn correctly without the mid-test fix Grim
authorized live ("make the fail handle red and the input handle white").
Adopted and hardened:

- **Handles are the source of truth for `when`.** `handleWhen()` in
  `workflow-editor.ts` maps sourceHandle → `when` for `fail`/`approve`/`deny`;
  a stale label never wins over the handle the edge was drawn from.
  `definitionToGraph` re-attaches when-edges to their outcome handle on load.
- **Rule + gate nodes:** pass handle (top-right) + red **fail** handle
  (bottom-right, `id="fail"`).
- **send-to-moderation nodes:** green **approve** + red **deny** handles, same
  mapping. `validate.ts` already restricts approve/deny edges to moderation
  nodes — unchanged, still enforcing.
- **Target handles white** for contrast against outcome colors.
- Round-trip tests: fail-handle edge saves as `when:"fail"`; approve/deny save
  as their when; handle-beats-stale-label; when-edges reload onto their
  handles; full graph→definition→graph identity with fail+deny edges. The
  committed editor-emission fixture (worker round-trip) is unchanged — node
  shapes didn't change, only handles.
- Known gap, out of scope here: **no node-config UI** (rule nodes always save
  `defaultConfig`) — separate session.

### Verdict replay — the missing §11 row + core CI gate (built on real flips)

Timely by design: units 1 (gate reachability) and 5 (deny floor) changed gate
and deny-resume semantics; the 15 stored runs were decided under the OLD
semantics. Replay is the review artifact that proves exactly what those changes
flip and nothing else.

- **`apps/worker/src/jobs/replay.ts`** (`bun run replay`): loads every stored
  run (or `--corpus <json>` / `--limit N`), re-normalizes the raw event with
  the CURRENT normalizer (stored normalized form as fallback), replays each
  rule node's recorded envelope verbatim from run_steps (what the rule
  actually SAW — replay NEVER fetches live GitHub; an uncaptured evaluation
  replays as `skipped: replay — evaluation not captured`), re-executes the
  run's own workflow SNAPSHOT through the current executor + degradation
  floor + resume/deny-floor semantics (moderation decisions re-applied from
  moderation_items), and diffs the derived verdict against the stored one.
- **Flip report** to stdout + `--out <json>`: run id, old→new, responsible
  semantics change (deny-floor / gate reachability / degradation floor /
  UNATTRIBUTED — investigate), evidence delta. **Fails ONLY on crash, never on
  flips** — flips are for human review.
- **Why envelope replay, not context rebuild:** diff/contributor reads are not
  stored anywhere except rule evidence; reconstructing RuleContext from
  rule-specific evidence shapes would be reverse-engineering. Replaying the
  recorded envelopes replays the ENGINE (executor, gates, floors, resume) over
  ground truth — which is precisely what the CI gate on core changes must
  catch. Rule-internal semantic changes are covered by the rules' own unit
  suites over fixture contexts.
- **CI (`.github/workflows/replay.yml`):** gated on `packages/core/**` paths,
  replays the committed corpus `apps/worker/fixtures/replay-corpus.json` —
  the 15 live scratch runs dumped via `--dump-corpus` (public-repo data,
  secret-scanned). Full-DB replay stays manual/local. `replay.test.ts` pins
  the corpus expectation (exactly the two explained flips, none UNATTRIBUTED)
  so `bun test` catches drift too; updating that expectation IS the human
  review moment.
- **Proof over all 15 stored runs:** 13 unchanged, 2 flips, 0 skipped, 0
  unattributed — exactly the T2a single-failing-rule pass→block (unit 1) and
  the T4 deny-produced pass→block (unit 5). Full report in all-summaries.
- `worstVerdict` exported from run-workflows (shared with replay);
  `runServices.listRunsForReplay` added (read-only corpus loader).

### Public run pages — BUILT (§10 access model live) + queue #11 closed

The deferred authored decision above, implemented as specced. Viewing is
public, deciding is gated:

- **`/runs/{id}` readable with no session.** `__root.tsx` exempts
  `isPublicPath()` (login + the single run page — run LISTS stay gated) from
  the session redirect. `getRun` is now the ONE server function that answers
  without a session; access shaping lives in `apps/web/src/lib/server/
  run-view.ts` (`loadRunView`) over the pure policy in `lib/run-access.ts`
  (`resolveRunAccess` / `toPublicRunView`, unit-tested).
- **Public view = verdict + per-rule steps + rule evidence + ai-review
  FINDINGS.** The ai-review raw trace is stripped from BOTH `evidence` and
  `output` (rule steps duplicate the envelope in output — stripping one would
  leak through the other); the workflow snapshot is nulled (repo config
  internals, not rendered anyway). Public render drops the dashboard chrome
  and carries the "powered by tripwire" footer; sessions get the dashboard
  view unchanged. A denied run returns null — indistinguishable from missing.
- **Private-repo gating = `repos.private` from installation sync.** No session
  + private OR unknown repo row ⇒ nothing (fail closed). MVP simplifications,
  ledgered honestly: (1) ANY session sees ANY run — there is no per-user
  repo-membership model yet ("sessions with repo access" ⇒ revisit when
  multi-maintainer/org lands); (2) the worker's lazy repo upsert (installation
  event never seen) now defaults `private: true` instead of `false` — change-
  request payloads don't thread visibility through contracts yet, so unknown
  visibility must gate rather than leak; the next installation event corrects
  it. Threading `repository.private` through NormalizedEvent is the follow-up
  if lazily-upserted public repos ever matter.
- **Defense in depth on the server-fn surface:** `requireSession()`
  (`lib/server/session.ts`, throws 401, open in dev posture) now guards
  decideModeration + listModerationQueue, getEvents, rules list/save,
  workflows get/save, analytics activity, home stats — the route redirect
  alone left the server-fn HTTP endpoints open. `decidedBy` now comes from
  the required session instead of a best-effort read.
- **Queue #11 closed in the same pass:** `describeSyntheticStep`
  (`lib/synthetic-steps.ts`) renders `run:deny-floor` as "denied by
  maintainer — no deny edge drawn…" and `run:degradation` with the skipped
  ratio + degraded reads; /moderation pins an "evaluation degraded" pill on
  `run:degraded` pending items. Deny-floor has no pending-queue presence by
  construction (it exists only after a decision) — the run page is its surface.
- Tests: pure policy matrix + trace-strip unit tests; 401 gate unit tests;
  and a REAL-Postgres integration suite (`run-view.integration.test.ts`):
  no-session public-repo read returns verdict+findings sans trace, private
  and orphan repos return nothing without a session, sessions/open-dev get
  the trace back.

### /rules absorption — the automod mockup over real data (§9 step 3)

The old automod mockup's charts/toggles UI becomes `/rules` populated by REAL
stored data — no new analytics system, no invented numbers. Honest-render
throughout: a stat/sparkline with no data shows the empty state, never a
seeded figure.

**Unit-2 residual fixed (the honest-display bug):** `/rules` showed an
unconfigured rule as `enabled ?? false`, UNDER-reporting what a fresh repo
actually runs — derive.ts runs baseline rules unless explicitly disabled. New
`apps/web/src/lib/rule-execution.ts#ruleExecutes` mirrors
`deriveDefaultWorkflow`'s overlay: explicit toggle wins; absent, a baseline
rule (a rule node in `DEFAULT_WORKFLOW`, the shared source of truth) runs and a
non-baseline rule does not. The toggle a maintainer sees now matches what the
engine executes. Where a repo has a saved workflow, the card shows "managed by
your workflow" (and the config editor is disabled) instead of a live-execution
toggle. Unit-tested (the 3 predicate cases + baseline membership).

**Data (no new pipeline):** `insightServices.getRulesStats(db, repoFullName)`
reads existing tables — matches from `run_steps` (rule-node fails), actioned
from `run_actions` (executed *enforcement* kinds only: block / label /
request-review / send-to-moderation / hide-comment — the always-emitted
`comment` and `set-check` surface artifacts are excluded, else a passing run's
success check would count as enforcement). Repo-scoped via `runs.repo_full_name`,
24h window, hourly sparkline buckets (the `hourlySeries` pattern from
`getHomeStats`). Per-rule 24h fail count + hourly series drives each card's
sparkline. Integration-tested on real Postgres (repo isolation, enforcement-only
counting, honest zeros).

**Header (4 cards):** active rules (execution count — a config number, so NO
faked chart/delta), matches · 24h and actioned · 24h (genuine time series →
dither sparkline), FP rate → "not enough data" (§6 loop needs reversals, which
aren't tracked yet). Per-rule cards: name + id@version chip + "change request"
target chip + action summary + the corrected toggle + 24h count + sparkline
(only when the trend is non-zero) + JSON config editor. Filters: sort (most
active / A–Z). **Omitted, not faked:** matcher-kind chips (RULE_CATALOG carries
no kind metadata) and FP-rate sort (empty stat).

Components: `rule-header-stats.tsx`, `rule-card.tsx` (folds in the retired
`rule-config-form.tsx`), `rule-filters.tsx`, rebuilt `rules-page.tsx`. No
content-rule work, no comment/issue targets, no ai-review opt-in changes, no
/automod route touched (all deferred per scope).

**Follow-up ledgered:** FP rate stays "not enough data" until the §6 reversal
loop (unhide/approve-as-FP) is tracked; matcher-kind chips need a `kind` field
on RULE_CATALOG if ever wanted.
