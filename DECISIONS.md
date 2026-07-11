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
