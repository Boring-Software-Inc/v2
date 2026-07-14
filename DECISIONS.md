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

### ai-review opt-in per repo (§8 owner decision)

ai-review costs tokens, so it's OFF by default and enabled per repo by a
maintainer — feature-flag-style, gated in the dashboard, recorded in the db.

- **Non-baseline rule.** `ai-review@1` is removed from `DEFAULT_WORKFLOW`
  (the baseline rule set). That single source of truth is what
  `deriveDefaultWorkflow` (execution) and `ruleExecutes` (the /rules display)
  both read, so they agree by construction: absent rule_configs row ⇒ ai-review
  doesn't run and shows OFF; enabled=true ⇒ opts in. No new repo seeds it (there
  is no rule_configs seeding on install — rows appear only when a maintainer
  saves a config), so fresh repos get it off for free.
- **RULE_CATALOG** entries gain an `optIn` marker (ai-review true, all others
  false) + a constitution-voice blurb ("off until you turn it on — ai review
  costs tokens"). The /rules card renders a disabled opt-in rule as an **enable
  affordance** (an offer with an "enable" button, config editor hidden), not a
  silently-off toggle like the others.
- **Keyless behavior unchanged** (confirmed, pinned): a workflow that includes
  ai-review with no `OPENROUTER_API_KEY` ⇒ the rule returns `skipped` ("generate
  unavailable") and counts toward the degradation floor. Rule-level skip was
  already covered (`ai-review/rule.test.ts`); the opt-in composition (enabled +
  keyless ⇒ skipped step in the run) is now pinned in `toggles.integration`.
- scratch's ai-review row set enabled=false (owner's test repo).
- **Replay invariant held.** `bun run replay --corpus` (the CI gate over the
  frozen 15-run corpus) stays EXACTLY 13 unchanged / 2 flips — a default change
  must not touch history, and it doesn't (snapshots are frozen; replay replays
  recorded envelopes). Live-DB replay reads 14/2 only because a 16th run
  (`019f5509`, the /rules-session derive live-check, a block replaying to block)
  was added to the DB between sessions — not a config-consultation regression.
- Tests: derive.test (ai-review non-baseline, opts in when enabled),
  rule-execution.test (predicate agreement), toggles.integration (opt-in +
  keyless skip).

**LEDGERED, not built:** an operator-level flag service (Databuddy) may later
gate WHO can enable ai-review — a DASHBOARD-layer concern only. Flag reads must
NEVER enter the worker's evaluation path; verdicts stay a pure function of
event + snapshot + rule_configs (the replay invariant). No billing, no budget
caps, no global kill switch — those are deploy-era.

### Public evidence split — contributor facts vs repo internals (§10)

The public run page was rendering raw rule evidence to anonymous visitors —
which mixes CONTRIBUTOR FACTS (observed values, already public on their own
diff — the appeal mechanism) with REPO INTERNALS (the maintainer's configured
thresholds + tripwire internals). The facts stay public; the internals gate.

- **The projection is rule-owned, in core.** `defineRule` gains two optional
  members next to `configSchema`/`resultSchema`: `publicEvidence(evidence)` (the
  allow-listed contributor-facing subset — safe by default, anything not
  returned is gated) and `summarize(evidence)` (the plain-English one-liner,
  constitution voice). Both live IN the rule file, versioned with it (same law
  as ai-review's instructions.md). Guidance: publish the OBSERVED value, gate the
  CONFIGURED threshold — account-age → accountAgeDays public / minDays gated;
  max-files → filesChanged / max; pr-rate-limit → count+intervalCov /
  windowHours+maxPerWindow; english-only → ratio+sample (threshold isn't in
  evidence); crypto → matches (all); honeypot → touched (globs live in config);
  min-merged-prs → mergedInRepo / min; profile-readme → length / minLength;
  ai-review → output (findings+summary+confidence) / trace gated.
- **The worker projects at persist time.** `apps/worker` is the only legal
  importer of core; `withPublicProjection` runs each rule's members and stores
  the result in new `run_steps.public_evidence` (jsonb) + `summary` (text)
  columns (migration `0001`). `toPublicRunView` gets DUMB — anonymous ⇒ swap the
  stored public_evidence in + attach summary; session ⇒ full raw evidence,
  thresholds, trace, timings, snapshot, unchanged (`toFullRunView` strips only
  the public-partition carrier fields). Web keeps ZERO rule knowledge.
- **WHY core+worker, not contracts.** A first pass put the partition + copy in
  `@tripwire/contracts` (web-reachable, no boundary hop). Rejected: that creates
  a SECOND home for rule knowledge (definition in core, copy+partition in
  contracts) with nothing keeping them in sync — the same drift class as the
  toggles-are-cosmetic bug, and it breaks contracts' zod-only invariant. Single
  home for rule knowledge (core), no drift surface, contracts stays pure.
- **Historical runs** have no projection (null) — the public view degrades to
  verdict + per-rule pass/fail without evidence detail (safe: no thresholds
  leak). No backfill shipped; if wanted it's a one-shot script over stored
  evidence, never a scheduled job.
- **Leak invariant (pinned).** A registry-wide test asserts NO configSchema key
  appears in any rule's `publicEvidence` output — a future rule can't leak its
  threshold by default. Plus: every rule defines both members or is listed in
  `PUBLIC_VIEW_OPT_OUT` with a reason (empty today). Replay corpus stays 13/2 —
  projections are presentation, not verdicts.

### App collapse to real surfaces — tripwire doesn't re-render GitHub (owner decision)

The redesign demo shipped ~95 components of mock-backed GitHub-browser pages
(repo lists, repo/thread analytics, issues/pulls index+detail, profiles,
integrations, automod). Owner decision: **tripwire is a gatekeeper, not a
GitHub mirror** — those surfaces re-render data GitHub already shows and will
never have a real source here. Deleted wholesale (not commented out, not
deferred), in three commits:

- **Unit 1** — deleted the `/$org/**` cluster (repos, repo analytics + issue/PR
  thread analytics, issues/pulls index + detail), `/profile/$userHandle`,
  `/$org/integrations/github`, `/automod` (route+components), `/dither-charts`,
  and the home `log` view (it linked to deleted routes). With them: their
  `*-mock-data.ts` seeds, `*.functions.ts`/`*.query.ts`, and components
  (`repo/`, `profile/`, `integrations/`, `automod/`, the repo-scoped `analytics/`
  subset, `log/`). Kept `/dither-kit` (unlinked dev reference) and the
  `analytics/` components the global `/analytics` uses.
- **Unit 2** — `/` renders the REAL moderation queue (`listPendingItems`,
  approve/deny, view-run) under the real `getHomeStats` header; `/moderation`
  redirects to `/` (one queue surface). Deleted the mock `QueueList` cluster and
  — importantly — the `seedStats` FALLBACK: a DB error now surfaces honestly
  instead of fabricating stat numbers (a fallback that lies is worse than a
  visible failure).
- **Unit 3** — the shell shows the REAL session user (`getCurrentUser`:
  better-auth session + `forge_identities.username`), with a clearly-labeled
  `local session`/`@dev` placeholder in open-dev — never the old hardcoded
  `MODERATOR` fixture. Nav is exactly Queue/Events/Rules/Workflows/Analytics
  (topbar + mobile footer); dropped Automod/Integrations/Profile/Settings and
  the hardcoded `/acme/*` org paths. `/analytics` collapses to the moderation
  source only (automod source branch + its mock data deleted); its back-link
  goes to `/`.

Every commit kept biome/typecheck/boundaries/193-tests green. Spec §4 surface
list rewritten to the final shape; §9 component org already matched it.

### /events → /activity — the live decision feed (§9)

The events page was a dead-end wall of rows. It's now the app's live activity
feed: each row is a normalized event joined to the run it triggered.

- **Data** — `eventServices.listActivity` (db/services, never the route) LEFT
  JOINs `events → runs` (0..1 — §5.11 joins workflows into one run) and a
  LEFT JOIN LATERAL for the first failing rule's `summary` (the §10 one-liner)
  as the leading reason. `getActivityForEvent(eventId)` returns one joined row
  for the live resolve.
- **Row states** — run present ⇒ verdict chip (blocked / passed / sent to
  review) + leading reason if failed, and the ROW IS A LINK to `/runs/$runId`;
  gated event still in flight ⇒ "evaluating…"; no run ⇒ a dimmed row with the
  reason derived from the event kind (push / comment / installation /
  maintainer — exempt).
- **Live, no polling** — the worker NOTIFYs a new `runs` channel at the END of
  `process-event` (run terminal/paused, OR no run at all — exempt/no-workflow)
  and on resume (moderation decision). The api SSE stream LISTENs `events`
  (new row) AND `runs` (re-fetch the joined row, push as a `run` event). The
  web merges both into the Query cache: `event` prepends an optimistic
  "evaluating…" row; `run` RESOLVES the matching row in place by event id —
  never a second row.
- **Filters** — client-side over the cached feed (instant): all · blocked ·
  sent to review · passed · no run. Live rows land in the cache regardless of
  the active chip; the view filters the cache, so a row arriving under a
  filtered-out chip still lands.
- Route renamed `/events` → `/activity` (it's no longer an event log); nav +
  SEO updated. Honest empty/error states. `listActivity` integration-tested.

### /activity — chain the feed by CHANGE REQUEST (§9)

Owner review of the flat feed: the real unit isn't the event, it's the change
request. "#1 fix typo" appearing 15× across 11h is one PR evaluated 15 times,
not 15 things. The feed is now grouped.

- **Grouping is done in SQL** (`eventServices.listActivityFeed`, db/services —
  never client-side over a paged list, or a group would split across pages). A
  CTE picks the top N change requests by `max(received_at)`; a second join pulls
  each group's full timeline (events + runs + the §10 leading reason). Standalone
  events (no `subject_number`: installation/push) are fetched separately.
  Groups and standalone rows interleave by latest activity.
- **One group = one collapsible row, collapsed by default.** Collapsed header:
  `#number title · actor · repo · current-verdict chip · count · relative time`.
  The current verdict follows the LATEST run in the timeline. Expanded shows the
  PR's timeline in chronological order — each entry links to `/runs/$runId` when
  it produced a run, else the event's GitHub `html_url`.
- **Live merge over the grouped cache** (`activity.query.ts`): a new `event`
  upserts a timeline entry into its group and BUMPS the group to the top (never
  grows the list); a new PR is a new group; a `run` resolves the entry in place
  and re-derives the group's current verdict. Ungrouped events prepend as
  standalone rows. Same SSE plumbing (`events` + `runs` NOTIFY), no polling.
- **Filter chips filter GROUPS by current verdict** (all/blocked/sent to
  review/passed/no run); standalone events only match all/no-run.
- Shared `VerdictChip` is the one verdict language across header + timeline.

### /activity — polish (5 defects on the grouped feed, §9)

- **Tripwire's own comments** stay (proof of action) but live INSIDE the change
  request's timeline, labeled `bot` and deduped. `normalize` sets a neutral
  `comment.byTripwire` flag (the forge-github COMMENT_MARKER stays its only home;
  a boolean threads through contracts, same pattern as html_url). One upserted
  artifact (§7) ⇒ create+edits collapse to ONE timeline entry (`buildGroup`
  server-side, `mergeEvent` live). Copy: "commented on #1", never "comment #3".
- **A blocked entry always says why.** The db's leading-reason lateral now also
  returns the first failing rule id; when the §10 summary is null (historical
  runs), the reason falls back to the bare rule name ("account-age failed").
  Plus a ONE-SHOT `scripts/backfill-public-projection.ts` (NOT scheduled) that
  re-projects stored evidence through the SAME `projectRulePublic` the worker
  uses — no second home for rule knowledge. Ran once: **backfilled 31 of 37**
  stale rule steps (6 yield no projection; 0 shape errors after unwrapping the
  RuleResult envelope stored in `run_steps.evidence`).
- **Exempt evaluations + all non-run context (push, comment) render DIMMED**
  inside the timeline — the system saw it and stood down; it must not compete
  with the verdicts.
- **Every entry is clickable**: a run → `/runs/$runId`; otherwise the event's
  GitHub `html_url` (PR, comment, or push `compare`). `push` gained an optional
  `url` (compare view) threaded through contracts + normalize.
- **The garbage fixture event** (`Codertocat/Hello-World`, 0 runs) was deleted
  with a one-off SQL statement — NOT an app delete path (the event store stays
  append-only, §5):
  `DELETE FROM events WHERE id = '019f50da-83f2-7000-909b-3bdf301e36c7' AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.event_id = events.id);`
- Root `package.json` gained `@tripwire/core`, `@tripwire/db`, `drizzle-orm` as
  devDeps so one-shot scripts in `scripts/` resolve the workspace packages
  (the boundary check only scans `packages/*`/`apps/*`, so this is legal).

### /activity — wire shapes to contracts + typed raw-row mapping (§4)

A live bug exposed a typing lie: `listActivityFeed` used `db.execute()` (raw SQL,
required for the LATERAL + grp CTE) and typed the rows `as unknown as
{received_at: Date}`. But raw pg rows are NOT Drizzle-mapped — timestamptz comes
back an **ISO string**, so `latest.received_at.toISOString()` threw at runtime.

Fixed structurally, not with a band-aid:
- **Wire shapes moved to `@tripwire/contracts/activity.ts`** as Zod schemas
  (activityRunSummary/TimelineEntry/Group/FeedItem/Feed). They crossed the
  server→client boundary and were duplicated in db/services AND web — the drift
  class. Both copies deleted; db + web import from contracts. `pending` is an
  explicit optional CLIENT flag in the entry schema (server never emits it) so
  the web augments the wire shape in place without a second type.
- **Every raw query maps through explicit coercion** (`mapEntry`/`mapRun`/`asMs`/
  `asIso`/`asString`), keyed off `Record<string, unknown>` — no `as unknown as`
  on query results. The one surviving `as` is `row.normalized as NormalizedEvent`
  (jsonb validated at write time, §5.6) with a comment; the audit found the only
  mistyped field was the timestamp (int4/text/jsonb come back correctly typed).
- **The server fn parses** `activityFeedSchema.parse(feed)` — a drifted normalized
  event or mistyped timestamp fails LOUDLY at the boundary, not in a render.
- **Integration test** (real postgres): `listActivityFeed` returns a group whose
  `latestActivityAt` is a valid ISO string and whose output parses clean against
  the contract, including a standalone (subject_number IS NULL) row.
- Audit of other web server-fn casts: only `rules.functions.ts` has two
  field-level `as JsonValue` (JSON coercion, not a return-shape cast) — left as is.

### Rules declare a remedy (§12, Unit A)

`defineRule` gains a REQUIRED `remedy: "revise" | "wait" | "appeal"` and an
optional `waitHint(evidence)` — same rule-owned, versioned-with-the-rule pattern
as publicEvidence/summarize. `remedy` answers "what can the contributor DO about
this block?" and drives the PR comment's "how do i fix this?" body; making it
required means a new rule can't ship without deciding (enforced by the compiler
+ a registry table test).

- Assignments: account-age=wait (+waitHint) · min-merged-prs=wait ·
  pr-rate-limit=wait · max-files-changed / english-only / crypto-address /
  honeypot / profile-readme / ai-review=revise.
- `waitHint` is wait-rules only and emits a DERIVED, threshold-free remainder
  ("it clears in 5 days" = minDays − accountAgeDays), never the configured
  threshold. Only account-age has a derivable one today; pr-rate-limit
  deliberately omits it — its evidence carries no per-request timestamps, so a
  window remainder can't be derived without leaking `windowHours`.
- The leak-invariant test is extended: a waitHint's output must contain no
  config-schema key (proven with wait-triggering sample evidence). Summarize
  one-liners are unchanged in this unit — the wording lands with the copy so the
  comment snapshots move in one place.
- Not a version bump: `remedy` is presentation metadata; it doesn't change any
  verdict or evidence, so historical `@1` runs stay interpretable (replay
  unchanged: 2 flips, same causes).

### The PR comment + review copy rewrite (§7/§12, Unit B)

The old comment counted rules ("tripped 1 of 8 rules" — meaningless to a
stranger), buried the run button in a "for maintainers" dropdown (but the run
page is the CONTRIBUTOR's appeal surface now, §10), and told everyone to "fix and
push" even when the failing rule was account age (no commit fixes that).

- **Never count rules.** The comment speaks the failing rules' `summarize()`
  one-liners: max 2 inline (each with its wait-hint appended — "your account is
  2 days old — it clears in 5 days"), 3+ collapse to "<first>, plus N other
  things." (no trailing pointer — the button implies it).
- **The button renders VISIBLY**, outside any `<details>`. The "for maintainers"
  wrapper is gone.
- **The "how do i fix this?" body is chosen by the failing rules' remedies**
  (Unit A): all-revise ⇒ push again · nothing-revisable ⇒ no commit clears it ·
  mixed ⇒ fix what you can. The appeal sentence rides along whenever anything is
  non-revise.
- **@-mention the contributor** on blocked + sent-to-review. **Drop the
  "tripwire:" prefix** everywhere (the bot name carries it) — headline is
  `**blocked**`, check summary/review body drop it too.
- The review stamp is one line: `blocked — {first reason}.` (no link/button).
- Reasons are built in the WORKER (`comment-reasons.ts`) — the only legal core
  importer — from each rule step's stored envelope via the rule's own
  summarize/remedy/waitHint. `emitPrSurface` takes `reasons: CommentReason[]`
  (dropped the `stats` rule-count entirely). Copy stays centralized in copy.ts.
- **Rule one-liners adjusted** to speak TO the contributor (this account → your
  account; found N → it adds N; percentage → "the title isn't in latin script";
  character count → "your github profile has no readme"). Not a version bump —
  summaries are projected/stored at persist time, so historical runs keep their
  stored text and stay interpretable; replay unchanged (2 flips).
- The condensedness test (asserted a 3-line shape) is replaced with assertions
  that matter: verdict line present, button OUTSIDE any `<details>`, no rule
  count, no "tripwire:" prefix in visible copy, contributor @-mentioned.

### Onboarding — user ↔ installation ↔ active repo (§10, Unit 1)

Tripwire becomes an app with accounts: sign-in gets a session, onboarding gets a
repo. Every dashboard surface is now scoped to the user's ONE active repo — the
repo dropdown on /rules and /workflows is gone.

- **Schema (migration `0002`):** `user_installations (user_id, forge,
  installation_id)` with `(forge, installation_id)` UNIQUE — an installation
  belongs to exactly one user; a second user's claim is a no-op (`claimed:false`).
  `user.active_repo_id` FK → `repos.id`. All granted repos stay synced via the
  existing installation-sync path; only the active one scopes the dashboard (no
  switcher, MVP). Boring shape: repos are reached through the installation
  (`repos.installation_id = user_installations.installation_id`), so a repo needs
  no user FK.
- **Setup URL callback:** `/onboarding/setup` (a TanStack route whose beforeLoad
  runs server-side) links the installation to the SIGNED-IN user, then routes to
  the narrowing step. Documented in `.env.example`: set the App's Setup URL to
  `${APP_URL}/onboarding/setup` and `GITHUB_APP_SLUG` builds the install link.
- **CSRF:** the install `state` HMAC-binds the initiating user id
  (`server/install-state.ts`, keyed by BETTER_AUTH_SECRET). The callback links
  only when the state's user equals the session user — a logged-in victim can't
  be tricked into claiming a foreign installation, and the UNIQUE prevents
  stealing an already-claimed one.
- **The gate:** `getSessionInfo` gained `onboarded` (has an active repo);
  `__root` beforeLoad redirects a signed-in, not-onboarded user to /onboarding
  (skipping /onboarding* itself), mirroring the /login redirect.
- **Scoping:** `listActivityFeed`, `getHomeStats`, `listPendingItems` take a
  `repoFullName`; `getActiveRepo` (server helper) resolves it per session.
  **Open-dev fallback:** no auth ⇒ no per-user active repo, so it falls back to
  the first installed repo — local dev stays usable. A fresh repo with no runs
  yields honest zeros (`ZERO_STATS`), not a spinner.
- **Repo sync timing:** the callback relies on the existing installation webhook
  to sync repos (web has no App creds). /onboarding shows a "finishing setup"
  state until repos appear, then narrows. Not wired to poll the GitHub API
  directly — a documented simplification.

**Honest ledger — NOT closed by this unit:** onboarding scopes the dashboard
LISTS, but a run fetched directly by id (`getRun`/`loadRunView`) is still not
authorized against the viewer's repo — any signed-in session can load any run by
id. Cross-user run authorization remains an open punt (spec §10).

**Also left global:** the /analytics drill-down activity
(`analyticsActivityQueryOptions` → listRecentDecisions/Runs) is not yet
repo-scoped (only its moderation stat cards are, via getHomeStats/getModerationStats).
A small follow-up; the owner's scope list was home / activity / moderation queue.

### Real empty states (§9, Unit 2)

A freshly-installed repo is the COMMON case, not an error — so every empty
surface now says what will fill it, not just that it's empty. One shared
`components/common/empty-state.tsx` (genuinely reused ≥2 surfaces, frontend.md):
a dashed card, one earned icon, terse title + a description of what lands there,
optional action — matched to the tripwire-design tokens (near-monochrome, small
calm type, rounded-lg).
- Home moderation queue: "nothing awaiting moderation — blocked changes that need
  a maintainer's decision land here."
- /activity: distinct "no activity yet" (repo linked and listening) vs "nothing
  matches this filter"; the error branch is an EmptyState too.
- /rules + /workflows: a "no repo linked yet" state (the real empty — reached in
  open-dev with an empty DB), plus a pre-first-run hint on /rules when nothing's
  been evaluated in 24h.
- Stat cards stay honest zeros (a real number beats a fabricated one).

### /activity — stacked cards, no dropdowns (§9, Unit 3)

The collapsible-group UI is replaced with always-visible card STACKS — no
expand/collapse toggle, so a change request's whole timeline is legible at a
glance. Supersedes the earlier "one collapsible group per PR" decision.

- One stack = a container that `rounded-xl` + `overflow-hidden` clips its inner
  cards, which are divided by a top border with NO gaps: the top card rounds up,
  the bottom rounds down, the middle is square. Gap is BETWEEN stacks. This gives
  the exact per-card corner rule without per-card radius bookkeeping.
- The top card is the stack header (repo · #num · title · actor · current verdict
  chip · time), linking to the current run (else the PR).
- **Truncation (revised to match owner's Paper design):** a stack shows its
  FIRST 10 entries; the tail fades under a bottom PROGRESSIVE BLUR (stacked
  backdrop-blur layers `[1,2,4,8]px`, each masked lower at 22% steps) with a
  "show more (N)" pill (N = hidden count) that reveals the rest INLINE — no
  pagination, no first+middle+last sampling.
- Unchanged: live SSE merge (event upserts + bumps the stack, run resolves in
  place), verdict chips, filter chips, tripwire-comment dedup+label, dimmed
  exempt/no-run entries, every entry clickable (run → /runs/$id else html_url).
  The SQL grouping stays in db/services; this is presentation + active-repo scope.

### Onboarding callback — link on session, state optional (fix)

Live bring-up surfaced two blockers in the Setup URL callback:
- **State was a hard gate.** A direct install from GitHub's own UI carries no
  `state`, so `completeInstallation` refused to link (user_installations stayed
  empty → /onboarding kept showing the install prompt despite repos syncing).
  Fix: link on the SIGNED-IN session; a PRESENT state must still HMAC-match
  (CSRF), but its absence no longer blocks. Residual risk (tricking a logged-in
  victim into claiming a fresh installation) is the ledgered punt; the
  `(forge, installationId)` UNIQUE still prevents stealing a claimed one.
- **Params could be stripped.** However GitHub's Setup URL is configured (some
  installs land on `/setup`), the `__root` gate now funnels any signed-in
  request carrying `?installation_id=…` into `/onboarding/setup` WITH its search
  params, before the onboarding redirect can drop them.

### Run page — step + findings enrichment (§8/§10, owner Paper design)

An enrichment of the live run page (the rail/steps already existed). Fidelity
pulled from the owner's Paper `/run/:runId`; finding SEMANTICS from the written
spec where the two diverged (the Paper still showed old per-finding pass/fail
badges — a finding is a negative observation and carries a SEVERITY, not a
verdict).

- **Steps.** A PASSED step stays one line: label · its `summarize()` one-liner
  (muted, sans) · status · timing. A FAILED step expands: header, then the
  statement (the same one-liner at 15px/24, foreground, weight 500), then
  evidence. Colour is a budget — the status badge is the only saturated element;
  a passed step is quiet. Step label uses the rule ref (mono), "ai review" for
  the AI step, and a bare node kind for non-rules — never "trigger: trigger".
- **Status/timing hug their content** (no fixed-width right gutter) — spec §3's
  "no third edge". (The activity feed keeps its own fixed-width chip column; a
  different surface, a different earlier decision.)
- **`summary` now rides the FULL run view.** `toFullRunView` previously dropped
  it ("the maintainer reads raw evidence"); the run page needs the one-liner, and
  it's public-safe (derived from `publicEvidence`), so only the `publicEvidence`
  carrier is stripped now.
- **AI-review file containers.** Findings group by file into surface-1,
  fill-only, rounded containers (raised, not nested). Header: file icon · path
  (directory dim ~55% / basename bright + weight 500) · severity counts
  ("3 critical · 1 note"), linking to `github.com/{repo}/blob/{sha}/{file}`. A
  file with ≥ 3 findings collapses behind a chevron; < 3 renders inline.
- **Finding cards** are fill-only, `rounded-md`, tinted by severity so no two
  share a surface (critical surface-1+7% destructive · warning +6% amber · note
  plain surface-1). Meta = severity word (its colour) + "line N" (muted); the
  reason is the brightest text (13px/20, foreground) and links to the line. No
  pass/fail badge.
- **Type + spacing scale** written into `.claude/skills/tripwire-design` so it
  isn't re-invented: mono only for rule ids/paths/code, 4px rhythm, line-heights
  16/20/24, sizes 11/12/13/15, two horizontal axes.
- **Hygiene.** The findings severity map is typed `Record<FindingSeverity, …>`
  (a new severity can't render as an invisible dot); deleted the
  `translate-y-[-1px]` baseline hack (the grid handles it); the feed's
  truncation fog now reuses the existing `.fluted-glass` class (masked to fade
  in) instead of a second progressive-blur primitive.

### ai-review@2 — backticked identifiers (version bump)

The finding reason must quote the code it accuses (`secrets.GITHUB_TOKEN`,
`pull_request`, `.github/workflows/exfil.yml`) so it reads as evidence, not
prose. That's a material prompt change ⇒ a new version.

- `instructions.md` (@1) is untouched, byte-for-byte; `@1` stays registered so
  stored @1 runs remain interpretable (versioning law). `@2` uses a new
  `instructions-v2.md` = @1 + one output rule about backticks. `rule.ts` is a
  small factory (`defineAiReview(version, instructions)`) registering both.
- `RULE_CATALOG` pins ai-review to `@2`, so a repo that enables it now runs the
  current version; existing @1 configs keep working.
- The findings renderer already parses inline backticks → `<code>` chips
  (surface-2 mono, sanitized as text) — it handles @2's backticked notes and
  @1's plain notes identically.
- **Replay unchanged:** `bun run replay --corpus` = 15 runs · 13 unchanged · 2
  flips · 0 skipped (the same unit-1 gate-reachability + unit-5 deny-floor
  flips). Replay reuses each run's stored snapshot and stored step envelopes and
  never re-invokes the model, so a prompt change cannot move a verdict.

### Home stat cards — one window per card, queue-depth series (§13.10)

The home cards showed a number and a sparkline computed over different windows, so
they contradicted each other. The fix is one rule: **a card's `value` and its
`series` describe the SAME window.**

- **`sentToReview` is state, not flow.** Its number is the CURRENT queue depth
  (`moderation_items` still pending, repo-scoped) and its series is a 24h
  queue-DEPTH curve — `depth(t) = count(items created ≤ t AND not decided by t)`.
  The last point (t = now) equals the number by construction. Owner's call, and
  "the whole bug": the last point of the series IS the number.
- **`blocked` / `passed` are 24h flow** — count of `runs` with that verdict in the
  window, plus an hourly series over the same window; delta vs the prior 24h.
- **Series bucket by hours-ago, not clock-hour.** `floor(extract(epoch FROM
  (now() - t)) / 3600)` mapped to `series[23 - h]`, so index 23 is the current
  hour (chart right edge = "now") and the window fills honestly. The old
  `extract(hour FROM t)` clustered events by wall-clock hour. Same fix applied to
  the /rules page series (`matchesSeries`, `actionedSeries`).
- **Two dead cards retired.** "Automod · 24h" (automod concept killed) and
  "Banned" (no ban concept — the value was a hard-coded 0). Replaced by the three
  above; no vanity fourth ("evaluated · 24h" = blocked + passed + review, already
  on screen).
- **Delta colour is explicit per metric.** `invertDelta?: boolean` became
  `goodDirection: "up" | "down" | "neutral"`. `sentToReview` down = good (queue
  shrinking); `passed` up = good; `blocked` is **neutral grey** — up is genuinely
  ambiguous (gate working OR under attack), and green would be the product
  congratulating itself for blocking people, which §12 forbids. A ZERO delta is
  neutral and omitted (never a red ▼0).
- **Honest render.** An all-zero window shows "not enough data" in the card, not a
  flat line pretending to be a trend.
- **Analytics stays in sync in the same commit.** `moderationMetrics` and
  `getAnalyticsActivity` (the /analytics drill-down) moved to the same
  review/blocked/passed set, so the drill-down doesn't break. Contract
  `modStatsSchema` renamed `pendingReports/resolvedToday/automodHits24h/
  bannedUsers` → `sentToReview/blocked/passed`.
- **Dither chart primitives untouched** — the owner considers them final; only the
  card wrapper's delta logic and empty-state changed.

### Dev persona switcher — dev-only auto-login without OAuth (§13)

A dev convenience (inspired by spatie/laravel-login-link, adapted to Tripwire's
STATES not SaaS tiers): auto-login as a default persona, a switcher to jump
between the six real product states, and auto-created fixtures per persona.

- **Real sessions, no OAuth.** The switcher mints a REAL better-auth session via
  email/password (`auth.api.signUpEmail`/`signInEmail`, `asResponse` → the
  Set-Cookie is forwarded), never a faked cookie and never bypassing session
  *verification*. `createAuth` gains a `devLogin` flag that enables the
  email/password provider; the web head passes `import.meta.env.DEV`, so a
  production bundle never enables it (the sign-up/sign-in endpoints are absent).
- **This implies auth is ENABLED locally.** The personas only mean anything when
  the gates actually function (onboarding redirect, the picker, the public-run
  stranger view). So the switcher requires `BETTER_AUTH_SECRET` to be set — in
  open-dev posture (no secret) `getAuth()` is null and `/api/dev/*` returns 503.
  `dev:demo` (Unit 2) sets a dev secret so the switcher works there.
- **Two guards, both throw, layered.** (a) COMPILE-TIME: every entry point lives
  behind `import.meta.env.DEV` — the `/api/dev/*` route in `start.ts`, the
  switcher UI, the auto-login trampoline — so the code is dead-code-eliminated
  from prod. (b) RUNTIME: `assertDevLoginAllowed` refuses any non-loopback host
  even in a dev build. No env flag can enable this elsewhere; there is no escape
  hatch. Unit-tested: production ⇒ throws, non-localhost ⇒ throws.
- **Auto-login is a trampoline, not a /login bounce.** A gated route with no
  session in dev redirects to `/dev/auto-login?to=…`, which mints the DEFAULT
  persona and lands you in the app — zero clicks, and you never see /login.
  `/login` stays reachable directly and shows the persona panel.
- **Default persona = `active`** (the populated dashboard) — the best first
  view of the product, not the empty "fresh maintainer" state.
- **Fixtures auto-create on demand** (spatie's create-missing-users): each
  persona's installation/repos/story are built on click, keyed by the resolved
  user id + deterministic `demo-inst-*` installation ids, so there is no seed
  script to remember. Persona repos are per-persona names (`solo-webapp`,
  `many-*`, `active-webapp`, …) so their installation ids never collide.
- **Seeding lives in `@tripwire/db`** (`seed.ts`), NOT in an app, so BOTH the web
  switcher and the `dev:demo` CLI share ONE shape-correct builder. `@tripwire/db`
  cannot import `@tripwire/core`, so runs are constructed to satisfy the same
  contracts (snapshot, RuleResult step envelopes, public evidence + summary,
  recorded-then-executed actions) rather than by invoking the executor — §13
  explicitly permits this. Locked by an integration test over real Postgres.
- **`reset dev data` is namespaced.** `resetDemoData` deletes ONLY the
  `tripwire-demo/*` repos and their runs/steps/actions/moderation/rollups/config,
  the `demo-evt-*` events, and `@tripwire.demo` users (auth cascades their
  sessions/accounts/installations). It never truncates a real table.

### `dev:demo` — embedded PGlite, web head only (§13)

`bun run dev:demo` seeds a story and serves the WEB HEAD ALONE — no Docker, no
worker, no api, no queue. A demo never processes a webhook; it looks at a
dashboard with a story in it.

- **New dependency: `@electric-sql/pglite` (`^0.2.17`).** An embedded, in-process
  Postgres (WASM). Chosen because it is the SAME dialect as prod: the identical
  Drizzle schema and the identical generated migrations run on it (via
  `drizzle-orm/pglite` + its migrator), so there is no second dialect and no
  drift.
- **SQLite was considered and REJECTED.** It would fork the read path — the
  activity feed's LATERAL query, `jsonb`, `timestamptz` — into a second dialect
  for zero benefit PGlite doesn't already give. One dialect is the whole point.
- **Hoisted at the ROOT, not per-package.** `drizzle-orm` treats
  `@electric-sql/pglite` as an OPTIONAL peer, so declaring it inside
  `@tripwire/db` forked db's drizzle into a second variant and broke the web↔db
  type identity (web passes `eq`/`sql` into db services). Declaring it once at
  the root makes the peer resolvable for every drizzle consumer, collapsing back
  to a single `drizzle-orm` instance.
- **`PGLITE_DATA_DIR` selects the driver.** `getDb()` (web) branches: when the
  env var is set it returns a PGlite-backed drizzle instance; otherwise the
  node-postgres pool. The shared `Db` type stays single-driver — one documented
  cast in `createPgliteDb` bridges the pglite drizzle instance, rather than
  widening `Db` across the whole services layer.
- **No queue in demo, so one write path degrades.** Only the approve/deny action
  needs pg + pg-boss. In demo mode it calls a worker-free
  `markModerationDecided` (records the decision so the queue updates; nothing
  resumes, because there is no worker). Every other server function uses `.db`
  and is unaffected. A stub pool throws loudly if any code reaches for `.pool` in
  demo — never a silent hang.
- **The seed process and the web process are sequential over the PGlite dir.**
  PGlite is single-connection; the `dev:demo` script seeds (owns the dir),
  closes, then spawns vite with `PGLITE_DATA_DIR` pointing at the same dir.
- **`dev:demo` sets a fixed `BETTER_AUTH_SECRET`** so posture is "enabled" and the
  gates + persona switcher work (the anonymous/public-run persona needs real
  no-session semantics). `.demo/` is gitignored.

### Run page evidence — the stored §10 projection, never raw JSON (Unit 1)

The run page rendered a raw evidence `<pre>` for every rule — the exact artifact
the evidence split (§10) was built to replace. `run_steps` already store
`summary` (the plain-English line) and `public_evidence` (the allow-listed
facts); the page now consumes them.

- **The statement is the stored `summary`.** For most rules that IS the whole
  story ("your account is 5 days old", "you've opened 9 change requests today").
- **Detail blocks ONLY for rules that point at THINGS**, in ai-review's visual
  language (file rows / cards): honeypot ⇒ the `touched` files as file rows
  (dir dim · basename bright · GitHub blob link); crypto-address ⇒ one card per
  `matches` entry (address as a mono chip + where). Every other rule gets NO
  detail block — inventing evidence UI for a rule that points at nothing is
  noise.
- **One set of primitives.** The file-row / file-path / blob-link pieces moved to
  `evidence-parts.tsx`; ai-review's findings and the new rule detail blocks both
  import them. No second set.
- **Raw is maintainer-only, collapsed, and shows `evidence` — not the envelope.**
  The old blob dumped the whole RuleResult envelope (`passed`/`ruleId`/`status`/
  `evaluatedAt`) — plumbing. The disclosure now shows the inner `evidence` only
  (thresholds, the ai-review trace), and never renders for a public visitor
  (`maintainer = run.access !== "public"`).
- **The fallback is the rule BLURB, not the id.** A pre-projection historical run
  (null summary) falls back to what the rule CHECKS (its catalog blurb) — never a
  blank step, never raw JSON, and never just echoing the rule id already in the
  header. (The owner's brief said "rule name"; the blurb is strictly more
  informative and same intent — noted here as the deviation.)
- **The demo seed now produces the REAL projection.** `ruleProjection` builds
  per-rule `evidence` + `public_evidence` + `summary` mirroring core's
  `publicEvidence`/`summarize`, shared by the year-long story AND the single-run
  path, so EVERY seeded run (including the public one) reads real — otherwise the
  new UI would only ever show the fallback. A latent seed bug surfaced and was
  fixed: a decided review's `decided_at` could land in the future, counting in
  queue depth but not the pending count (breaking series[23] === value) — clamped
  to `now`.

### min-merged-prs@2 — an unsatisfiable rule, fixed by versioning

@1 required `contributor.mergedInRepo >= min` — merged change requests IN THIS
repo. That is unsatisfiable for any first-timer (to merge here you must open here;
to be allowed to open you must already have merged here). A repo with `min: 1`
silently banned every new contributor, forever; its "wait" remedy was a lie.

- **Shipped as @2; @1 is FROZEN and registered, byte-for-byte.** Stored `@1` runs
  reference it forever (versioning law). Replay proves history is untouched:
  `bun run replay --corpus …` → **15 runs · 13 unchanged · 2 flips · 0 skipped**
  (the two flips are the pre-existing unit-1 gate-reachability + unit-5 deny-floor
  flips on `account-age@1`, NOT min-merged-prs).
- **New meaning: GLOBAL merged change requests, excluding repos the contributor
  owns.** The real signal is "someone else reviewed and accepted their work."
  Without the exclusion an attacker self-creates a repo, self-merges a PR, and
  fakes the check in 90 seconds.
- **Exclusion implementation + its honest limit.** The read adds ONE GitHub
  search — `author:X is:pr is:merged -user:X` — and takes `total_count`. The
  `-user:X` qualifier drops repos the contributor OWNS (the stated attack vector).
  "Repos they can PUSH to" (collaborator on someone else's repo) is NOT
  expressible as a search qualifier and would need a per-repo permission call per
  result — rate-limit-heavy, beyond the one-page MVP read. So @2 excludes by
  OWNERSHIP; the self-owned self-merge (the 90-second attack) is closed, and the
  narrower collaborator case is a recorded limitation, not a silent gap.
- **Degrades honestly.** `ContributorProfile.mergedElsewhere` is `number | null`;
  null (not 0) on a failed search — 0 would read as "no reputation". The rule
  SKIPS when the contributor read or the global count is unavailable (§6), never
  guesses.
- **`mergedInRepo` became an EXEMPTION, not a requirement (owner decision).** A
  proven local contributor (`mergedInRepo >= trustedAfter`) passes regardless of
  their global count — you don't re-gate someone the repo already trusts. The
  count stays in evidence either way; it's a free trust signal.
- **Config default: `{ min: 1, trustedAfter: 1 }` — justified.** min-merged-prs is
  NON-baseline (absent from the derived default), so a fresh install never runs it
  — the default applies ONLY when a maintainer explicitly enables it. At that
  point `min: 1` asks for a single externally-accepted merge — the minimal honest
  reputation floor — and is ALWAYS satisfiable (contribute to any repo you don't
  own), the exact property @1 lacked. `trustedAfter: 1` exempts anyone who has
  already landed one merge in THIS repo. Safe (satisfiable, off-by-default) and
  meaningful. Every config field carries `.describe()` (rule-owned form copy).
- **remedy is now honestly `wait`** (contribute elsewhere and it clears) with a
  `waitHint` that prints only the remainder ("it clears after N more accepted
  merges elsewhere"), never the configured threshold — the leak-invariant test
  covers it. publicEvidence exposes observed counts only (`mergedElsewhere`,
  `mergedInRepo`); `min`/`trustedAfter` stay gated.
- **Catalog → @2; baseline unchanged.** `deriveDefaultWorkflow` derives from
  `DEFAULT_WORKFLOW`, which never referenced min-merged-prs, so no baseline/derive
  edit was needed; `ruleExecutes` and the derived default still agree (both keyed
  off the same baseline set).

### PR comment lifecycle — verdict transitions get their own comment (§7)

Real incident (Boring-Software-Inc/dither-kit#8): a blocked contributor fixed the
change and the comment was EDITED IN PLACE to "passed" — the receipts vanished and
the resolution landed at the TOP of a long thread where nobody reads. This
SUPERSEDES the earlier "one comment, always upsert" decision.

- **Same verdict on a re-run ⇒ EDIT in place** (unchanged, the common path). Ten
  broken pushes are one comment, ten edits, zero thread noise.
- **A verdict transition ⇒ a NEW comment** (chronologically after the commit,
  where the eye reads) AND the previous comment is marked SUPERSEDED. Only
  transitions create comments — never a CodeRabbit thread.
- **RUN HISTORY is the single source of truth — no dual detection.** The worker
  computes `previousVerdict` from the run history (`getPreviousVerdict`) and passes
  it to the adapter; `upsertComment` decides edit-vs-transition SOLELY from it. The
  `<!-- tripwire:run -->` marker is used ONLY to LOCATE the active comment, never
  to infer what happened. (An earlier draft inferred the previous verdict from a
  second marker in the thread too — "they agree in practice" is the same excuse
  that preceded the toggles-cosmetic bug; the moment a human deletes or edits the
  comment the two disagree and you post "that's cleared" with no prior block in the
  thread. Removed — the marker no longer encodes a verdict.)
- **A transition whose old comment is GONE still posts.** If run history says
  transition but the marker isn't found (deleted/edited by a human), the resolution
  comment posts anyway with nothing to supersede — never silently a "first
  verdict". A superseded comment LOSES its marker, so there is always exactly ONE
  active comment; the find is unambiguous and idempotent (a retried transition
  re-finds the new comment and edits it).
- **Superseded format:** the old verdict's human text (headline + reasons) struck
  through, then `superseded — see the newer check below.` The button + collapsibles
  + marker are dropped (everything from the first HTML block on) — a struck-through
  button is noise.
- **Resolution copy knows the previous verdict.** `commentHeadline` takes the same
  worker-supplied `previousVerdict`: blocked→passed "that's cleared. good to
  merge."; blocked→sent to review "that's cleared the rules. a maintainer takes it
  from here."; →blocked "the last push brought something back." (+ the normal block
  body); first-time verdicts unchanged.
- **Stale review dismissal (same incident).** A `block` files a CHANGES_REQUESTED
  review that cannot self-edit, so a now-passing PR permanently carried "tripwire
  requested changes" — dead-merge on required-review repos. On a block→(pass|sent
  to review) transition the worker looks up the outstanding review's forge id
  (`getLatestBlockReviewId` — the block action's stored external id) and enqueues a
  new `dismiss-review` action; the adapter `PUT`s the dismissal. Best-effort (a
  failure warns and settles the row, never kills the run) and idempotent
  (keyed on the review id; re-dismissing is a harmless no-op).
- **Comment ownership is UNCHANGED and now also gates the dismissal** — only the
  latest run per change request may post a transition or dismiss a review; a stale
  run's comment/dismiss row is superseded. The sweeper's staleness guard is
  untouched.

### Live E2E for the comment lifecycle — `bun run test:lifecycle` (§11)

The comment-lifecycle integration tests prove the LOGIC against a fake adapter;
they do not prove GitHub accepts our calls or that the THREAD ends up correct.
The block→pass transition is the exact flow that broke on a real contributor's PR
(dither-kit#8), so it earns a scripted live E2E — a regression guard for that
incident.

- **Tier: §11 live E2E — nightly / pre-release only, NOT per-PR CI.** It needs
  real credentials, a running worker, a tunnel routing the sacrificial repo's
  webhooks, and a non-exempt pushing account. Documented in the README; not wired
  into `bun test` or the CI gate.
- **Asserts REAL GitHub state, never our DB.** It reads issue comments, reviews,
  and check runs via `gh api` and drives one PR through blocked → passed → blocked,
  asserting at each step: the number of tripwire comments (by bot author), which
  one carries the `<!-- tripwire:run -->` marker, that a superseded comment is
  struck and marker-less, the request-changes review's state (present →
  DISMISSED → a new one), and the `tripwire` check conclusion on each head SHA.
- **Trips `crypto-address`, not honeypot.** A wallet address in the diff is
  deterministic and — unlike a `.github/workflows/**` honeypot file — needs no
  `workflow` OAuth scope to push. Extends the existing `test:run` harness's
  env-routing (`TEST_REPO` / `TEST_BASE` / `TEST_LIFECYCLE_BRANCH` / `TEST_WORKDIR`
  / `TEST_TIMEOUT_MS`).
- **Idempotent + self-diagnosing failures.** It wipes any prior lifecycle
  PR/branch before starting (clean slate on every run), polls GITHUB'S PR head SHA
  (not the local git SHA — so propagation lag or any local↔remote divergence can't
  masquerade as a stall) until the `tripwire` check completes, and on timeout
  PRINTS exactly what GitHub sees: the head vs the expected SHA, every check run on
  that SHA ("NONE" ⇒ the run never reached GitHub — worker creds / app install /
  webhook secret / tunnel), and the tripwire comment count. Exits non-zero on any
  assertion failure; leaves the artifacts on failure to inspect (cleanup on
  success only).
- **Deliberately NOT automated: whether the copy READS well.** The script proves
  the mechanics; a human reads the thread once. Taste stays human — stated in the
  README and the script header.
- **New dep:** `@tripwire/forge-github` in the root devDependencies, so the script
  imports `COMMENT_MARKER` + `CHECK_NAME` from the source of truth rather than
  hardcoding structural tokens that would silently drift.

## Deploy to Railway (2026-07-13)

Owner call: all three services on Railway (web + api + worker), Postgres on
PlanetScale, Railway Hobby. Motivation: `APP_URL` was `localhost`, so every
blocked contributor got a dead run link + a broken badge image (this hit a real
contributor on dither-kit#8). Local dev (`dev:demo`, tunnel, `test:run`) stays
unchanged — this is an infrastructure unit, application code is touched only
where deployment genuinely requires it (PORT handling, worker healthcheck, the
LISTEN/NOTIFY connection split in Unit 3).

### Unit 1 — containerize

- **Three Dockerfiles, build context = monorepo root** (`docker build -f
  apps/<svc>/Dockerfile .`). api + worker use `oven/bun:1.3-slim` and run
  TypeScript **directly** (Bun, no compile step). web uses `oven/bun` to build
  and **`node:22-slim` to serve** — the nitro SSR runtime is Node, not Bun.
- **web: `NITRO_PRESET=node-server` is forced at build.** Built under the Bun
  image, nitro auto-detected the Bun runtime and emitted a `Bun.serve` bundle
  that throws `Bun is not defined` under `node`. Forcing the node preset makes
  the output node-native (the generateId portability lesson, second instance).
- **web: `VITE_SITE_URL` is a build ARG, not a runtime env.** It is read via
  `import.meta.env` (seo.ts) and inlined at build; a runtime value is ignored, so
  the real public URL must be passed to `docker build`/Railway's build step or
  canonical/OG tags bake to localhost. Everything else the web server reads
  (`VITE_API_URL`, `BETTER_AUTH_*`, `APP_URL`, `GITHUB_OAUTH_*`, `DATABASE_URL`)
  is runtime `process.env`.
- **No `--production` on the Bun installs.** The `@tripwire/*` workspace packages
  link through the ROOT devDependencies; `--production` dropped the
  `node_modules/@tripwire` symlinks and every import failed. bun also nests
  workspace links (`apps/<app>/node_modules`, `packages/*/node_modules`), so the
  runtime stage copies the **whole installed tree** from the install stage, then
  overlays real source over the manifest-only stubs (COPY merges).
- **PORT handling.** Railway injects `PORT` per service; each service is an
  isolated container so there is no cross-service PORT collision (the collision
  that bit us was two heads on one local host). api now binds
  `PORT ?? API_PORT ?? 8787`; the worker's new health server and web (nitro) both
  honor `PORT`.
- **Worker healthcheck.** The worker had no HTTP surface, so a crashed/hung
  consumer was invisible. Added a tiny `Bun.serve` `/healthz` on
  `PORT ?? WORKER_HEALTH_PORT ?? 8181` reporting `{ok, github, aiReview}` so
  Railway's healthcheck sees a dead worker and the degradation posture is legible.
- **`.dockerignore`** keeps `node_modules`, build output, `.demo`, `.env*`, and
  docs out of every build context. `docker-compose.yml` is unchanged (local dev).
- **Verified locally against the compose Postgres:** all three images build; api
  `/healthz`→`{ok:true}`, worker `/healthz`→`{ok:true,github:disabled,...}`, web
  serves (307→/login under node). Posture guard confirmed: api with
  `NODE_ENV=production` and no `BETTER_AUTH_SECRET` **exits 1** ("refusing to
  boot").

### Unit 2 — Railway config + env matrix + DEPLOY.md

- **Config-as-code, one file per service:** `apps/{api,worker,web}/railway.json`
  (builder `DOCKERFILE`, `dockerfilePath`, healthcheck, watch patterns). Each
  Railway service points its config path at its own file.
- **Root Directory = repo root for all three.** The Dockerfiles COPY from the
  monorepo root; a per-app root directory would shrink the build context and
  break the build. Documented as a load-bearing gotcha in DEPLOY.md.
- **Watch patterns isolate rebuilds:** a change only under `apps/web/**` rebuilds
  web alone; `packages/**` rebuilds all three (shared code). This is what keeps a
  web-only change from rebuilding the worker.
- **web healthcheck = `/login` (200), not `/` (307).** `/` redirects based on
  auth state; Railway's healthcheck wants a stable 200. api/worker use `/healthz`.
- **Env matrix documented in full** (which service, which is secret). Two names
  the owner-supplied env list simplified: the "real public web URL" is actually
  three web/api vars (`BETTER_AUTH_URL`, `VITE_SITE_URL` [build-time],
  `WEB_ORIGIN`) plus the worker's `APP_URL`; `VITE_API_URL` is the public **api**
  URL. `GITHUB_APP_*` + `GITHUB_WEBHOOK_SECRET` go on **both** api and worker.
- **Production posture checks are asserted in the deploy checklist:** missing
  `BETTER_AUTH_SECRET` refuses to boot (confirmed exit 1 in Unit 1), and
  `TRIPWIRE_DISABLE_EXEMPTION=true` is refused under `NODE_ENV=production`.
  DEPLOY.md tells the owner never to paper over either.
- **Rollback documented:** Railway redeploy of the last good image; revert+push;
  webhook repoint back to the tunnel; PlanetScale branch/backup restore
  (migrations are forward-only — no down-migrations).

### Unit 3 — PlanetScale: pooled/direct split + verify gate

- **Two connection strings (sanctioned app change):** `DATABASE_URL` (pooled) for
  all transactional/query work + pg-boss; `DATABASE_URL_DIRECT` (direct/session)
  for LISTEN/NOTIFY ONLY. New `createDirectPool()` in `@tripwire/db` reads
  `DATABASE_URL_DIRECT ?? DATABASE_URL`, so local dev (one Postgres, no pooler)
  is byte-for-byte unchanged. Owner's design: LISTEN needs a persistent session
  a transaction-mode pooler drops.
  - api SSE stream: `directPool.connect()` holds the `LISTEN` (was `pool.connect()`).
  - worker: its `pool` is used ONLY for `pg_notify`, so the whole worker `pool`
    dep is now the direct pool; queries + pg-boss stay on the pooled `db`.
- **`bun run verify:planetscale` — the pre-cutover gate** (`scripts/verify-planetscale.ts`,
  depends only on `@tripwire/db` so it resolves from the repo root). Asserts and
  exits non-zero:
  - **A. Transaction affinity (pooled).** Runs the REAL ingest (`insertRawEvent`:
    INSERT event + pg-boss enqueue in one tx) and confirms atomic commit; then a
    second attempt is ROLLED BACK and it proves neither the event row nor the job
    survived. A statement-level pooler would autocommit the pg-boss insert on a
    different backend → it survives the ROLLBACK → the script fails loudly.
  - **B. LISTEN/NOTIFY (direct).** LISTEN + NOTIFY across two direct connections,
    payload asserted within 7s. **On failure the script STOPS — it does NOT fall
    back to 2s polling** (a recorded spec decision, not the script's call).
- **Verified locally:** exits 0 against the compose Postgres (both invariants
  trivially hold with no pooler); exits 1 with the STOP message when
  `DATABASE_URL_DIRECT` is unset. All 52 api/db/worker tests pass with the split;
  the SSE integration test still exercises LISTEN/NOTIFY through the direct pool.
- **Region pair (recorded):** Northern Virginia — Railway `us-east4` +
  PlanetScale AWS `us-east-1`. Colocated because pg-boss polls and rules are
  chatty; a cross-continent hop taxes every query.

### Unit 4 — cut over (runbook + deploy smoke)

- **Owner-gated, scripted where it can be.** Creating the DB, deploying,
  repointing the webhook, and pushing the smoke PR are the owner's (secrets never
  enter an agent session). The assertable parts are scripts the owner runs.
- **`bun run smoke:deploy` (`scripts/smoke-deploy.ts`, zero deps) is the crux
  regression guard:** the badge PNG (`${APP_URL}/badges/view-run.png`) returns
  200 + `image/png` (not the alt-text/404 of the localhost bug), and the public
  run page (`${APP_URL}/runs/:id`) resolves 200 UNAUTHENTICATED with the "powered
  by tripwire" footer and no login redirect. This is the mechanical half of smoke
  steps 4 + 5 — the exact surfaces the deploy exists to fix (dither-kit#8).
  *Verified against the containerized web: the badge is served, 200 image/png,
  ~29KB.*
- **The PR flow (steps 1–3, 6) reuses `bun run test:lifecycle`** — it already
  asserts REAL GitHub state (check conclusion on head SHA, one @-mention comment
  by the bot naming the rule, block→pass supersede + resolution + review
  present→DISMISSED→new). No duplicate script.
- **Two steps stay human by design:** the owner eyeballs that the badge *renders*
  in the PR and the run page *reads* right (§10 taste — plain-English, no raw
  trace/thresholds). Step 7 (SSE live tick on `/activity`) is a maintainer-session
  eyeball that also proves LISTEN/NOTIFY survives the deployed direct connection
  end to end.
- **Runbook in DEPLOY.md §5:** deploy order + boot-health assertions (worker logs
  "github app credentials OK"), webhook repoint to `https://<api>/webhooks/github`,
  set `APP_URL` to the real web URL, the 7-criteria smoke mapped to the scripts,
  and rollback (Railway redeploy / revert+push / repoint webhook back to the
  tunnel / PlanetScale branch restore).

### Unit 4 follow-up — §10 leak invariant (mechanical proof) + smoke correction

- **Where the leak proof actually belongs.** The owner asked the deploy smoke to
  assert the public run page HTML carries NO threshold key (`minDays`,
  `maxPerWindow`, `windowHours`, `max`, `minLength`) and no `trace`. Investigating
  showed the run page (`/runs/$runId`) has **no route loader** — it hydrates its
  data CLIENT-SIDE via the `getRun` GET server-fn, so the SSR HTML carries no run
  data at all (the runId isn't even in it). A raw-HTML grep therefore can't see a
  leak — and the old smoke check for the "powered by tripwire" footer would have
  **false-failed on a real deploy** (that footer renders after hydration). Fixed.
- **The mechanical proof is a projection test, not an HTTP grep.** The public page
  renders exactly `toPublicRunView`'s output (the getRun response), so asserting
  that pure projection IS the proof, and it runs every PR (not just at deploy).
  Extended `run-access.test.ts`: a run that tuned several rules (all five
  threshold keys in the workflow snapshot AND echoed into raw evidence, plus the
  ai-review raw `trace`) is projected to public and asserted to leak NONE of the
  six tokens — WITH TEETH (the same tokens are asserted present in the full
  maintainer view, so a pass is never vacuous), plus `snapshot === null`.
- **Smoke corrected.** `smoke:deploy`'s run-page check no longer greps HTML for
  the footer/leak; it asserts the page is SERVED 200 to an anonymous request (the
  public-path allowlist holds — a real §10 regression guard: if `isPublicPath`
  broke, a stranger would hit /login). The badge check (200 + image/png) is
  unchanged. DEPLOY.md §5 step 5 updated to point the leak invariant at the CI
  projection test.
- **Not reverse-engineered.** Hitting `getRun` from the smoke would mean
  replicating TanStack Start's seroval GET-payload wire format against a compiled
  server-fn id hash — brittle coupling to build internals. Rejected in favor of
  the projection test.

## Repo arming + scope model (2026-07-14)

Product-safety hole: GitHub's install flow offers "All repositories", and a synced
repo with no rule_configs runs the DERIVED BASELINE gate (derive.ts) — so
installing on a 400-repo org would immediately start BLOCKING PRs across all 400
with rules the maintainer never chose. In prod today four synced repos were all
being gated; only dither-kit was intended. Fixed by arming.

### Unit 1 — `repos.armed` (the safety floor)

- **`repos.armed` boolean NOT NULL DEFAULT false** (migration `0003`). The default
  + `ADD COLUMN … DEFAULT false NOT NULL` sets EVERY existing repo (prod's four
  included) to unarmed; the owner re-arms what he wants.
- **Arming is always explicit.** `setRepoArmed` is the ONLY writer. `ensureRepo`
  and `syncInstallationRepos` never touch `armed` (their upsert `set` excludes it),
  so a re-sync / reinstall PRESERVES the maintainer's choice — a repo can't be
  silently disarmed by an install refresh. Onboarding's "pick a repo" scopes the
  dashboard; it does NOT arm.
- **Worker skip = the exemption shape.** `runWorkflows` returns `none` right after
  the repo fetch when `!repo?.armed` — no run, no check, no comment, no action
  rows — and logs "repo not armed — event ingested, run skipped". Placed BEFORE
  context-building so an unarmed repo costs zero forge reads.
- **Events STILL ingest for unarmed repos** (owner decision): the webhook lands,
  the raw event is stored, it normalizes — only the RUN is skipped. The
  append-only store stays complete, which is what makes arm-time backfill (Unit 3)
  possible. Proven by a dedicated test: unarmed repo ⇒ 0 runs but the event's
  `normalized` column is non-null.
- **`armed` surfaced on `RepoLite`** (+ `REPO_LITE` select) so the active repo
  carries it to the UI; the arming UI (banner, inert states, feed "not armed")
  lands in Unit 2 as one coherent pass.
- **dev:demo unbroken:** `ensureDemoRepo` arms every demo repo, so the demo shows
  the working-gate story, not the call-to-action.
- **Tests:** the run-expecting integration suites (toggles, moderation,
  process-event) now arm their fixture repo in setup; new gate test added. Full
  suite 239/239.

### Unit 2 — the arming affordance (unmissable)

- **Unarmed is a call to action, never an empty state.** A single reusable
  `ArmCallout` (`components/arming/`) with two variants: `hero` DOMINATES the home
  page (what arming does + one ARM button), `banner` LEADS the scoped pages
  (rules, workflows, activity) while their content stays visible-but-inert below
  ("what's below is what will run once you arm it"). Constitution voice — lowercase,
  no exclamation marks, "change request", never "bot".
- **`armActiveRepo` server fn** (`arm.functions.ts`) is the only UI path to arming:
  resolves the active repo (session or open-dev first-repo) and `setRepoArmed(true)`.
  The mutation invalidates broadly on settle so the now-armed dashboard fills in;
  toasts "tripwire is now watching {repo}". Unit 3 enqueues backfill from here.
- **Activity feed:** a no-run event on an unarmed repo reads **"not armed"** (an
  `unarmed` prop on `ActivityRow` overrides the generic no-run reason) instead of
  looking like a stuck evaluation — the Unit 1 data (no runs) made visible.
- Home's early return sits below the hooks (unconditional-hooks rule); the
  moderation dashboard is silent until the gate is on.

### Unit 3 — arm-time backfill

- **Reuse the real engine, never hand-insert runs.** Arming enqueues a
  `backfill-repo` pg-boss job; the worker replays the repo's STORED
  change-request events through `runWorkflows`, producing real runs/steps/
  verdicts — indistinguishable from live in the data model.
- **The one hard requirement — no PR surfaces on historical threads.**
  `runWorkflows({ surface: false })` records its action rows as **`suppressed`**
  instead of `recorded`. The sweeper's `listStuckActions` filters `recorded`
  only, so a suppressed row is never executed; the backfill path also never calls
  `emitPrSurface`/`emitPendingCheck`. Result: history without a single comment or
  check on an old change request. Proven by a test (run persists, verdict block,
  every action row `suppressed`).
- **Bounded burst.** N = **30 days**, capped at **50** change requests (one run
  per change request — its current head), paced 400ms apart. Stored events don't
  need re-fetching, but each RuleContext still needs forge reads (diff,
  contributor) — sequential + delay keeps ~150 API calls well under an
  installation's limit. A failed read degrades that one run (the fail-closed
  floor), never the backfill.
- **Progress is on `repos`** (`backfill_total`/`backfill_done`, migration 0004),
  surfaced on `RepoLite`. `BackfillProgress` polls the active repo every 2s while
  a backfill is in flight and shows "backfilling — N of M change requests" on
  home + activity; the dashboard fills in live via `pg_notify('runs')` per run.
- dev:demo unaffected — arming there skips the enqueue (no worker/queue).

### Unit 4 — the repo switcher

- **Scope stays one active repo; the switcher changes which.** Topbar trigger
  (shows the active repo) + a ⌘K command palette. Selecting a repo is
  `chooseActiveRepo` → `user.active_repo_id` (already persisted server-side), so
  the active repo survives reloads with no client storage.
- **Rows carry SIGNAL, not just a name** — armed dot · pending-moderation count ·
  blocked-24h — so the switcher is triage. `listSwitcherRepos` computes them in
  ONE query (repos ⋈ user_installations, LEFT JOIN pending moderation / blocked-24h
  runs / max event time), **sorted by recent activity** (the repo you want is the
  one that just had something happen), grouped by owner in the UI.
- **Defaults to repos WITH ACTIVITY**, a footer toggle shows all — a 400-repo org
  drowns in empty repos otherwise. **Unarmed repos appear with an inline arm**
  affordance (`armRepoById`, access-checked against the user's switcher list;
  arming enqueues backfill like the CTA).
- **Search is client-side** over the fetched list (the design guidance: fine under
  ~200; server-side search is the scale follow-up for large orgs — noted, not
  guessed). Modal a11y: the backdrop is a real button, the panel a `role=dialog`
  sibling (no stopPropagation), Esc closes.
- Deep-link `?repo=` (the shared-link constraint) rides with Unit 5's routing pass.

### Unit 5 — home goes cross-repo

- **Home is the ONLY cross-repo surface.** Scope's weakness: you're inside
  dither-kit while scratch has items waiting and can't see it. Fixed at the front
  door — `/` shows "across your repos — N awaiting, N blocked today" + a per-repo
  breakdown ranked by attention (pending desc → blocked-24h → recent activity).
  Clicking a repo `chooseActiveRepo` → scopes in → `/moderation`. Reuses the
  switcher signal query; unarmed repos show as "available — not armed", never zeros.
- **The scoped moderation queue moved to `/moderation`** (the reverse of the old
  redirect); an unarmed active repo shows the arm hero there. Topbar nav: Home
  (`/`, cross-repo) + Queue (`/moderation`, scoped). Everything else stays scoped.
- Spec §4/§10 updated: arming, the scope model, the switcher, cross-repo home.
- **Deferred (one constraint):** deep-link `?repo=owner/name` on the scoped routes.
  The active repo is persisted per-user server-side, so a shared `/rules` link
  shows the RECIPIENT's active repo (a safe default, not the wrong config) — the
  `?repo=` override (validateSearch + active-repo override on each scoped route)
  is a focused follow-up, flagged rather than half-built.

## The interactive live-E2E harness — `bun run test` (2026-07-13, §11)

Three one-off scripts (`test:run`, `test:lifecycle`, `smoke:deploy`) and a dozen
untested App states (fork PRs, drafts, force-push, bot authors, uninstall mid-run,
rename, rate limits, private repos, member/outside/stranger). Replaced the scatter
with ONE funnel-driven harness under `scripts/e2e/` — 3 prompts (axis → outcome →
method) reach ~18 scenarios, every interactive path has a `--only/--expect` flag
equivalent (clig.dev).

### Dependencies (owner-locked stack)

- **`@clack/prompts` · `commander` · `picocolors`** added to root devDependencies.
  Net-new — they replace nothing; the harness is a new surface. Bun/node can't do
  a funnel prompt UI + POSIX flag parsing + TTY-gated colour without them. Stack
  matches the dither-kit CLI (owner decision). **No Ink** (owner). This is the
  DECISIONS entry AGENTS.md requires for new deps.

### Unit 1 — `TRIPWIRE_FAIL_READS` (the degraded floor, on a live PR)

- The fail-closed floor (reads degrade → rules skip → verdict floors to
  `needs_review`) had no way to be exercised end-to-end. Added a dev-only env,
  **gated non-production exactly like `TRIPWIRE_DISABLE_EXEMPTION`**: a value of
  `diff,commits,contributor` (or `all`) makes those context guards in
  `worker/context.ts` throw. Refused under `NODE_ENV=production` — a prod worker
  never self-degrades on a flag. `readsInjectionRefusedInProd` logs the refusal at
  run time, mirroring the exemption warning. Pure over an env bag; unit-tested.

### The harness (Units 2–4)

- **Scenarios are DATA** (`scenarios.ts`): `{ name, axis, plan, expects, needs,
  enableRules, run }`. Adding a state is a new entry, never new menu code. `run`
  does setup AND records assertions on a shared `Asserter` — assertions are data,
  so the runner renders a ✓/✗ diff and the exit code follows (0 all-pass, non-zero
  on any failure → it can gate a release).
- **Assert against REAL GitHub** via `gh api` (check conclusion on the head SHA,
  comment count + marker + supersede, review dismissal) — never our DB for the
  GitHub-facing checks. `waitForVerdict` polls GitHub's head (not the local SHA)
  and dumps a diagnosis on timeout (ported from the old lifecycle script).
- **Two ways to be non-exempt, picked automatically**: `direct` (local, worker has
  `TRIPWIRE_DISABLE_EXEMPTION`) when `TEST_CONTRIBUTOR` is unset; `fork` (a
  genuinely non-exempt cross-repo PR) when it's set. Environment-agnostic scenarios
  read `ctx.defaultMode`, so ONE entry covers local and prod. The exempt-member
  scenario asserts the ABSENCE of a run (a shorter bounded wait).
- **Reused, not reinvented**: the config surface is identical to `test:lifecycle`
  (`TEST_REPO/TEST_BASE/TEST_CONTRIBUTOR/…`) — no new config. Rule-config pinning
  snapshots + restores the maintainer's real config on exit (extracted + generalised
  from the lifecycle script).
- **Folded in**: `test:run` → `--only gate-pass`; `test:lifecycle` → `--only
  comment-lifecycle`; `:prod` → the same under `.env.e2e` (fork mode). The two
  standalone scripts (`trigger-test-run.ts`, `test-lifecycle.ts`) were DELETED — no
  parallel entry points. `smoke:deploy` stays separate (HTTP surface, not PR flow).
- **`test` rebinds to the harness**; the unit/integration/contract/snapshot suite is
  `bun test` (the runner, unchanged) with a new `test:suite` alias. CI invokes
  `bun test` directly, so the rebind doesn't touch the CI gate.
- **clig.dev**: `--no-input` requires `--only`/`--everything`; colour + spinners
  only on a TTY; `NO_COLOR`/`--no-color` respected; `--json` for machines;
  `--everything` runs the scriptable set (skips hybrids unless `--with-hybrid`) with
  a summary + `--only` repro hints; `--keep` leaves a PR open; cleanup is idempotent
  and fires in each run's `finally` (so an interrupt doesn't leave half-open PRs).
- **Hybrids** (uninstall / rename / merged-elsewhere) print `[YOU: do X — done?]`,
  wait, then assert — the deploy-runbook pattern. Interactive only.
- **Honest degradation**: scenarios that need a precondition the harness can't force
  (a moderation-routing workflow for `gate-needs-review`, a populated recent-PR
  window for `edge-rate-limit`, a bot author) say so in the plan and log, rather
  than faking a pass. README documents every one.
- **Checks**: biome (338 files), boundaries, typecheck all packages, 248 tests. The
  harness itself is typechecked out-of-band (scripts aren't in a package tsconfig,
  same as the scripts it replaced).
