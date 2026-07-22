# ROUTE-MAP — Tripwire web app inventory

Read-only audit. Snapshot of what IS. `apps/web/src/routes/**` uses TanStack
Router **flat file-based routing** (dotted filenames, e.g.
`$org.$repo.analytics.index.tsx`), NOT nested `_app/` folders. There is **no
`_app` pathless layout route** — the shared dashboard shell is a plain
component (`DashboardLayout`) that each page component wraps itself in. Auth is
gated once in `__root.tsx` `beforeLoad`; a second layer (`requireSession()`)
lives inside some server functions.

Legend for data labels: **REAL** (server fn → `@tripwire/db` service → tables) ·
**MOCK** (seed file) · **HYBRID** (mix) · **DERIVED** (client-computed) ·
**EMPTY** (honest empty state).

---

## Global auth + shell facts

- **Root gate** — `routes/__root.tsx` `beforeLoad`: if `isPublicPath(pathname)`
  return (open); else read `getSessionInfo()` and, when `authEnabled && !user`,
  `redirect({ to: "/login" })`. When auth env is absent (local dev) the gate
  stands open for everything.
- **`isPublicPath`** (`lib/run-access.ts`): only `/login` and `/runs/{id}` (regex
  `^/runs/[^/]+/?$`). Every list/index route stays behind the root gate.
- **Server-fn gate** — `requireSession()` (`lib/server/session.ts`): throws 401
  when `authEnabled && !userId`; returns null in open-dev.
- **Shared shell** = `components/layouts/dashboard-layout.tsx` → renders
  `DashboardTopbar` + side-panel grid + `MobileFooter`. Every dashboard page
  component wraps its content in `<DashboardLayout moderator={MODERATOR}
  counts={…}>`. `MODERATOR` is a hardcoded constant from `lib/site-config.ts`
  (the "signed-in maintainer" is a fixture, not the real session user).
- **Topbar nav** (`dashboard-topbar.tsx`) hardcodes the org/repo segment:
  Analytics → `/acme/tripwire/analytics`, Integrations →
  `/acme/integrations/github`. `MobileFooter` repeats 4 of the 8.

---

## Routes

### 1. `/` — Moderation home / queue
- **File**: `routes/index.tsx` (`ssr: false`). Page component inline
  (`DashboardPage`).
- **Auth**: gated at root `beforeLoad`. Underlying stats fn has a mock fallback,
  no `requireSession`; queue/log/automod fns are mock, ungated.
- **Reachability**: topbar "Queue" (`to="/"`), also `/analytics` back-link and
  DitherStatCard back-target. The default landing page.
- **Shell**: `<DashboardLayout>`. ✔ consistent.
- **DOM**:
  ```
  <DashboardLayout counts={{queue, automod}}>
    <header> h1 "Moderation" + subtitle
    <grid 4×> <DitherStatCard × 4>   // Pending, Resolved today, Automod·24h, Banned
    <ViewToggle pending|log>
    view==="pending" ? <QueueList items title=ViewToggle>
                     : <LogList entries title=ViewToggle>
  ```
- **DATA**: **HYBRID** — the canonical real-header-over-mock-list page.
  - `<DitherStatCard × 4>` → **REAL** (w/ mock fallback). `moderationStatsQueryOptions`
    → `getModerationStats()` (`moderation.functions.ts`) → `insightServices.getHomeStats(db)`
    over tables `moderation_items`, `runs`. On DB error it catches and returns
    `seedStats()` from `lib/mock-data.ts`.
  - `<QueueList>` → **MOCK**. `moderationQueueQueryOptions` → `getModerationQueue()`
    → `seedFlaggedItems()` from `lib/mock-data.ts`. (Code comment: "queue list is
    still mock-backed".)
  - `<LogList>` → **MOCK**. `moderationLogQueryOptions` → `getModerationLog()` →
    `seedLogEntries()` from `lib/log-mock-data.ts`.
  - `counts.automod` → **MOCK** (`automodRulesQueryOptions` → seed, see /automod).
- **Residue**: header is post-demo real; queue + log lists are original demo mock
  by design. A REAL replacement for the list exists conceptually
  (`moderation_items` — used by `/moderation`) but is not wired here.

### 2. `/moderation` — Live paused-run queue
- **File**: `routes/moderation.tsx`. Component `LiveModerationQueue`
  (`components/moderation/live-queue.tsx`), sibling `…Skeleton`.
- **Auth**: gated at root; `listModerationQueue()` + `decideModeration()` DB
  reads/writes (queue fn does not itself call requireSession — root gate covers it;
  decide mutation writes via `moderationServices`).
- **Reachability**: topbar "Moderation" (`to="/moderation"`).
- **Shell**: `<DashboardLayout counts={{}}>`.
- **DOM**:
  ```
  <DashboardLayout>
    <header> h1 "Moderation" + subtitle
    items.length===0 ? <EMPTY "nothing awaiting moderation.">
    : <item-card × N>
        actorLogin · repoFullName #subjectNumber [·"evaluation degraded" if node="run:degraded"]
        relativeTime · <Link to="/runs/$runId">view run</Link>
        <button approve> <button deny>
  ```
- **DATA**: **REAL**. `moderationQueueOptions` → `listModerationQueue()`
  (`moderation-queue.functions.ts`) → `moderationServices.listPendingItems(db)`
  over `moderation_items` JOIN `runs` LEFT JOIN `events`. `decideModeration()`
  writes status + enqueues a pg-boss resume job. staleTime 5s. Empty state is
  honest **EMPTY**.
- **Residue**: none — this is the real surface. Note it overlaps the home `/`
  queue conceptually (home still shows the mock `QueueList` instead of this).

### 3. `/events` — Live event feed
- **File**: `routes/events.tsx`. Page `EventsPage` (`components/events/**`).
- **Auth**: gated at root **and** `getEvents()` calls `requireSession()` (both
  layers).
- **Reachability**: topbar "Events" (`to="/events"`).
- **Shell**: `<DashboardLayout>`.
- **DOM**:
  ```
  <DashboardLayout>
    <header> h1 "Events" + <LiveIndicator>
    [error] / [EMPTY] / <EventRow × N>   // icon + avatar + text + relative time
  ```
- **DATA**: **REAL**. `events.query.ts` → `getEvents()` → `eventServices.listEvents(db,{cursor,limit:50})`
  over table `events` (filter `normalized IS NOT NULL`, order `id DESC`).
  Live: `useEventStream()` subscribes to SSE `/api/events/stream` and merges
  `NormalizedEvent`s into the Query cache (cap ~200). Empty = **EMPTY**.
- **Residue**: none.

### 4. `/rules` — Rule configuration
- **File**: `routes/rules.tsx`. Page `RulesPage` (`components/rules/**`).
- **Auth**: gated at root **and** every server fn calls `requireSession()`
  (`listRepoOptions`, `listRuleConfigViews`, `getRulesHeaderStats`,
  `saveRuleConfig`) — both layers.
- **Reachability**: topbar "Rules" (`to="/rules"`).
- **Shell**: `<DashboardLayout>`.
- **DOM**:
  ```
  <DashboardLayout>
    <header> h1 "Rules" + <select repo>
    [no repos → EMPTY]
    <RuleHeaderStats>: <PlainStatCard active> <DitherStatCard matches24h>
                       <DitherStatCard actioned24h> <PlainStatCard FP-rate "not enough data">
    <RuleFilters sort>
    <RuleCard × N>   // name, id@version chip, target chip, action summary,
                     // Sparkline(24h), matches24h, Switch/enable-button, JSON config textarea
  ```
- **DATA**: **REAL / HYBRID (real DB over a static catalog)**.
  - Repos → `repoServices.listActiveRepos(db)` table `repos`.
  - RuleCards → `RULE_CATALOG` (static, `@tripwire/contracts`) **merged** with
    `repoServices.listRuleConfigs(db, repoId)` (table `rule_configs`) +
    `insightServices.getRulesStats(db, fullName)` (tables `run_steps`,
    `run_actions`). Catalog is the shape; enable-state, match counts, sparkline
    are real.
  - Header stats → real aggregates; `falsePositiveRate` is `null` → **EMPTY**
    "not enough data".
- **Residue**: none. (No `rules.query.ts`; query options live inline — a §9
  convention drift, not residue.)

### 5. `/workflows` — Workflow DAG editor
- **File**: `routes/workflows.tsx`. Page `WorkflowsPage` (`components/workflows/**`).
- **Auth**: gated at root **and** `getWorkflowForRepo` / `saveWorkflowForRepo`
  call `requireSession()` — both layers.
- **Reachability**: topbar "Workflows" (`to="/workflows"`).
- **Shell**: `<DashboardLayout>`.
- **DOM**:
  ```
  <DashboardLayout>
    <header> h1 "Workflows" + <select repo | "default workflow (read-only)">
    <WorkflowCanvas>
      toolbar: <AddMenu +rule (RULE_CATALOG × N)> <AddMenu +gate ×3> <AddMenu +action ×5> <button save>
      <ReactFlow>  <TripwireNode × N> + <Edge × M> + Background + Controls
  ```
- **DATA**: **REAL / HYBRID**. `getWorkflowForRepo()` → null repo returns static
  `DEFAULT_WORKFLOW` (`@tripwire/contracts`); else `repoServices.listEnabledWorkflows(db, fullName)`
  (table `workflow_definitions`) or falls back to `DEFAULT_WORKFLOW`.
  `saveWorkflowForRepo()` Zod-validates then `repoServices.saveWorkflowDefinition(db, …)`.
  AddMenu options are static `RULE_CATALOG` → **DERIVED**. (No `workflows.query.ts`;
  query options inline in the page — convention drift.)
- **Residue**: none.

### 6. `/automod` — Automod rules + stats
- **File**: `routes/automod.tsx`. Page `components/automod/**` (`RuleList`, `RuleRow`).
- **Auth**: gated at root only; server fns are mock, no `requireSession`.
- **Reachability**: topbar & mobile-footer "Automod" (`to="/automod"`); also the
  `/analytics` back-link when `source=automod`.
- **Shell**: `<DashboardLayout>`.
- **DOM**:
  ```
  <DashboardLayout>
    <header> h1 "Automod" + subtitle
    <grid 4×> <DitherStatCard × 4>   // Active rules, Matches·24h, FP rate, Actioned·24h
    <RuleList>: SortButton×3, FilterChip×5, <RuleRow × N>
                (CategoryIcon, name, action+scope, Sparkline, matches24h, Switch)
  ```
- **DATA**: **MOCK**.
  - Stats → `automodStatsQueryOptions` → `getAutomodStats()` → `seedAutomodStats()`.
  - Rules → `automodRulesQueryOptions` → `getAutomodRules()` → `seedAutomodRules()`.
  - Both from `lib/automod-mock-data.ts` (200ms fake delay).
- **Residue**: original demo, still mock by design. Overlaps `/rules` (the real
  rule surface). No real automod data source exists yet — closest real analog is
  `/rules`' `run_actions`/`run_steps` insights, but automod's shape differs.

### 7. `/analytics` — Global metric drill-down
- **File**: `routes/analytics.tsx` (`ssr: false`). Page inline `AnalyticsPage`.
  `validateSearch` → `{ source: "moderation"|"automod", metric: string }`.
- **Auth**: gated at root; `analytics-activity` fn calls `requireSession()`;
  stat/queue fns are mock.
- **Reachability**: DitherStatCards on `/` link here via `linkSearch`
  (`search={{source:"moderation", metric}}`); `AnalyticsMetricsSheet` "View full
  analytics"; `to="/analytics"` (1 direct). **Distinct from the org-scoped
  `/$org/$repo/analytics`** — the topbar's "Analytics" points at the org-scoped
  one, not this.
- **Shell**: `<DashboardLayout>`.
- **DOM**:
  ```
  <DashboardLayout>
    <Link back to "/" or "/automod">
    <header> focusedMetric label + <NumberFlow value> + Delta + "−Nh"
    <AnalyticsChart series interactive onCommit>
    <AnalyticsEvents events focusedId>
    <AnalyticsMetricsSheet>: <DitherStatCard × metrics>
  ```
- **DATA**: **HYBRID (by source)**.
  - Metric series/values → `moderationStatsQueryOptions` / `automodStatsQueryOptions`.
    Moderation stats **REAL** (getHomeStats, mock fallback); automod stats **MOCK**.
  - Event feed → when `source==="moderation"`: **REAL** —
    `analyticsActivityQueryOptions` → `getAnalyticsActivity()`
    (`analytics-activity.functions.ts`, `requireSession()`) →
    `insightServices.listRecentDecisions(db)` / `listRecentRuns(db)`. When
    `source==="automod"`: **MOCK** `seedAnalyticsEvents()` from
    `lib/analytics-events.ts` (automod branch of the fn returns `[]`).
  - This is the "real activity on moderation metrics" surface (commit 45832ac).
- **Residue**: moderation path real; automod path is demo mock.

### 8. `/$org/$repo/analytics` (index) — Repo analytics
- **File**: `routes/$org.$repo.analytics.index.tsx`. Page inline.
- **Auth**: gated at root only; `getRepoAnalytics` is mock, no requireSession.
- **Reachability**: **topbar & mobile-footer "Analytics"** →
  `/acme/tripwire/analytics` (hardcoded org/repo). Also `/$org/repos` rows link
  to `/$org/$repo/analytics`, and `RepoTabs`.
- **Shell**: `<DashboardLayout>`.
- **DOM**:
  ```
  <DashboardLayout>
    <RepoCrumbs> + <button "Last 30 days">
    <RepoTabs active="analytics">
    <RepoMetricCard × 3> · <ChartWithDrilldown> ·
    section "Blocked by rule" <BreakdownBar × n> · section "Most active threads" <ThreadLink × n>
  ```
- **DATA**: **MOCK**. `repoAnalyticsQueryOptions` → `getRepoAnalytics()` →
  `seedRepoAnalytics()` from `lib/repo-analytics-mock-data.ts`. (No repo-scoped
  activity feed here — the real activity lives on the global `/analytics`.)
- **Residue**: original demo, mock by design.

### 9. `/$org/$repo/analytics/issues/$id` — Issue thread analytics
- **File**: `routes/$org.$repo.analytics.issues.$id.tsx`. Page inline.
- **Auth**: gated at root only; mock.
- **Reachability**: `/$org/$repo/analytics` "Most active threads" ThreadLinks;
  `AnalyticsMetricsSheet` "View full analytics" from issue detail.
- **Shell**: `<DashboardLayout>`.
- **DOM**: `<RepoCrumbs>` + "View conversation" link → header (CircleDot, title,
  status) → `<RepoMetricCard × 4>` → `<ChartWithDrilldown>` → "Activity by
  participant" `<BreakdownBar × n>` + "Flagged in this thread" rows. Loading /
  "Thread not found." states.
- **DATA**: **MOCK**. `repoAnalyticsQueryOptions` → `seedRepoAnalytics().threads['issues/${id}']`.
- **Residue**: demo mock.

### 10. `/$org/$repo/analytics/pulls/$id` — PR thread analytics
- **File**: `routes/$org.$repo.analytics.pulls.$id.tsx`. Page inline.
- **Auth / Shell / Reachability**: same as #9 but pulls; header icon GitMerge/GitPullRequest;
  trailing section "Checks & reviews".
- **DATA**: **MOCK** — `seedRepoAnalytics().threads['pulls/${id}']`.
- **Residue**: demo mock.

### 11. `/$org/repos` — Repository list
- **File**: `routes/$org.repos.tsx` (`ssr: false`). Page `components/repo/**`.
- **Auth**: gated at root only; mock.
- **Reachability**: **only** from `RepoCrumbs` (`components/analytics/repo-crumbs.tsx`,
  `to="/$org/repos"`). No top-level nav item → near-orphan (reachable only by
  drilling into a repo first).
- **Shell**: `<DashboardLayout>`.
- **DOM**: `<RepoCrumbs org>` → header "Repositories" + count → `<RepoListRow × N>`
  (`Link to /$org/$repo/analytics`; name, Lock if private, description, openIssues/
  openPulls/flagged counts). Loading state.
- **DATA**: **MOCK**. `repoContentQueryOptions` → `getRepoContent()` →
  `seedRepoContent()` from `lib/repo-content-mock-data.ts`.
- **Residue**: demo mock.

### 12. `/$org/$repo/issues` (index) — Issues list
- **File**: `routes/$org.$repo.issues.index.tsx` (`ssr: false`).
- **Auth**: gated at root only; mock.
- **Reachability**: `RepoTabs` (`to="/$org/$repo/issues"`).
- **Shell**: `<DashboardLayout>`.
- **DOM**: `<RepoCrumbs>` → `<RepoTabs active="issues">` → `<ListFilterTabs open|closed>`
  → `<ThreadListRow × N>` (`Link to /$org/$repo/issues/$id`; CircleDot, title,
  LabelPill×, #num/relative/author, flagged+comment counts). Empty / loading states.
- **DATA**: **MOCK** (`seedRepoContent()` ISSUES). Open/closed split is **DERIVED**
  (client filter on `status`).
- **Residue**: demo mock.

### 13. `/$org/$repo/issues/$id` — Issue detail
- **File**: `routes/$org.$repo.issues.$id.tsx` (`ssr: false`, `validateSearch {c?}`).
- **Auth**: gated at root only; mock.
- **Reachability**: `/$org/$repo/issues` ThreadListRows; analytics "View
  conversation" links.
- **Shell**: `<DashboardLayout>` + `ThreadDetailShell` (scroll frame + analytics sheet).
- **DOM**: `<ThreadDetailShell kind="issue">` → `<RepoCrumbs>` + "View on GitHub"
  → `<ThreadView>` (title #num, status badge, labels, author/relative, optional
  branch, `<CommentCard>` opening + `<CommentCard × n>` with `?c=` highlight) +
  `<AnalyticsMetricsSheet>` (RepoMetricCard×, MetricDetailChart). Loading / "Issue
  not found." states.
- **DATA**: **MOCK**. Thread → `seedRepoContent()`; analytics sheet →
  `seedRepoAnalytics().threads['issues/${id}']`. `highlightId` from `?c` = **DERIVED**.
- **Residue**: demo mock.

### 14. `/$org/$repo/pulls` (index) — Pulls list
- **File**: `routes/$org.$repo.pulls.index.tsx`. Structurally identical to #12
  with PULLS data, `RepoTabs active="pulls"`, links → `/$org/$repo/pulls/$id`.
- **DATA**: **MOCK** (`seedRepoContent()` PULLS); open/closed **DERIVED**.
- **Residue**: demo mock.

### 15. `/$org/$repo/pulls/$id` — PR detail
- **File**: `routes/$org.$repo.pulls.$id.tsx`. Identical to #13 with `kind="pull"`,
  branch/baseBranch shown, analytics link → `/$org/$repo/analytics/pulls/$id`.
- **DATA**: **MOCK** — `seedRepoContent()` pull detail + `seedRepoAnalytics().threads['pulls/${id}']`.
- **Residue**: demo mock.

### 16. `/runs/$runId` — Run detail (PUBLIC)
- **File**: `routes/runs.$runId.tsx`. Component `RunPage` (`components/runs/**`),
  sibling `RunPageSkeleton`.
- **Auth**: **PUBLIC** — `isPublicPath` allows it through root gate. `getRun()`
  reads session but does **not** `requireSession`; access is computed by
  `resolveRunAccess({authEnabled, hasSession, repoPrivate})` → `full` | `public`
  | `denied`. Public view is sanitized by `toPublicRunView()` (drops
  `snapshot`, strips ai-review `trace`).
- **Reachability**: **external deep-link** — the PR comment button. URL built in
  `apps/worker/src/jobs/pr-surface.ts:90` as `${appUrl}/runs/${runId}`, rendered
  by `renderCommentBody()` (`packages/forge-github/src/actions/comment.ts`).
  Also in-app: `/moderation` "view run" `Link`.
- **Shell**: **CONDITIONAL** — `access==="public"` → **standalone** (min-h-dvh
  column + "powered by tripwire" footer, no shell); `access==="full"` →
  `<DashboardLayout counts={{}}>`. The only route that renders both shelled and
  standalone.
- **DOM**:
  ```
  RunPage → (public ? standalone+footer : DashboardLayout) → <RunBody>
    <header> h1 "Run" + verdict badge [pass|block|needs_review] [+ "awaiting moderation"]
             repoFullName · #subjectNumber · createdAt · headSha
    <StepCard × N>: status dot, ruleRef|"{nodeKind}:{nodeId}", status, durationMs
        ruleRef^="ai-review@" ? <AiFindings summary+confidence, findings[severity,file:line,note]>
                              : <EvidenceView <pre>JSON.stringify(evidence)>
    actions.length>0 ? <ActionRow × N> {kind, status, recordedAt}
  ```
- **DATA**: **REAL**. `runs.query.ts` → `getRun()` → `loadRunView()` →
  `runServices.getRunWithSteps(db)` over tables `runs`, `run_steps` (+ actions).
  `access` is **DERIVED** (`resolveRunAccess`). Public sanitization drops
  `snapshot` → **EMPTY** in public view.
- **Residue**: none — the flagship real page.

### 17. `/profile/$userHandle` — Contributor profile
- **File**: `routes/profile.$userHandle.tsx` (`ssr: false`). Page `components/profile/**`.
- **Auth**: gated at root only; mock, no requireSession.
- **Reachability**: `UserMenu` (topbar dropdown) "Profile" → `to="/profile/$userHandle"`
  with `params.userHandle = MODERATOR.login`.
- **Shell**: `<DashboardLayout>`.
- **DOM**: back button → `<ProfileBody>`: banner+avatar, identity (handle,
  joined/repos/followers, Watchlist/Block buttons), "Contributions" +
  `<ContributionGraph>` (53×7 heatmap), Details column (`DetailRow ×4`, "In your
  repos" `RepoStat` 2×2) + `<ProfileActivity>` (`ActivityRow × N`).
- **DATA**: **MOCK**. `contributorProfileQueryOptions` → `getContributorProfile()`
  → `seedContributorProfile(handle)` from `lib/contributor-mock-data.ts`
  (deterministic mulberry32 PRNG per handle). Code comment: "Mock-backed. In a
  real deployment this would hit the GitHub API + the moderation store."
- **Residue**: demo mock.

### 18. `/$org/integrations/github` — GitHub integration
- **File**: `routes/$org.integrations.github.tsx`. Page `components/integrations/**`.
- **Auth**: gated at root only; mock.
- **Reachability**: topbar & mobile-footer "Integrations" →
  `/acme/integrations/github` (hardcoded org).
- **Shell**: `<DashboardLayout>`.
- **DOM**: header "GitHub" → `<GithubAccountCard × n>` (avatar, login/type, Manage/
  Uninstall) + "Connect another account" → "Active repository" section (search,
  `<RepoRow × N>` with Set-active, `<RepoPagination>`, info line).
- **DATA**: **MOCK**. `githubIntegrationQueryOptions` → `getGithubIntegration()` →
  `seedGithubIntegration()` from `lib/integrations-mock-data.ts`.
- **Residue**: demo mock. (Real repo/installation data exists in `repos` table —
  used by `/rules` — but this surface consumes the seed.)

### 19. `/login` — Sign-in (PUBLIC)
- **File**: `routes/login.tsx`. Component `LoginPage` (`components/auth/**`), skeleton.
- **Auth**: **PUBLIC** (`isPublicPath`).
- **Reachability**: root `beforeLoad` redirect when unauthenticated; topbar
  UserMenu "Log out" → `window.location.assign("/login")`.
- **Shell**: **standalone** (centered card, no DashboardLayout).
- **DOM**: centered card → site name + tagline → "continue with github" Button
  (`authClient.signIn.social({provider:"github", callbackURL:"/"})`, toast on
  error) → "maintainers only" note.
- **DATA**: **EMPTY** (no data; auth client action only).
- **Residue**: none.

### 20. `/dither-charts` — Chart-kit demo (DEV)
- **File**: `routes/dither-charts.tsx` (`ssr: false`). Component inline.
- **Auth**: gated at root (not public) — but demo-only.
- **Reachability**: **ORPHAN** — nothing links here. Reachable only by typing the URL.
- **Shell**: `<DashboardLayout>`.
- **DOM**: showcase grid of every dither chart primitive (Area/Bar/Line/Pie/Radar…)
  with shuffle/refresh buttons.
- **DATA**: **MOCK/DERIVED** — local `seedData()` sine/cos generator, no server fn.
- **Residue**: **dev/demo residue**. Component-library showroom, not a product page.

### 21. `/dither-kit` — Chart-kit docs (DEV)
- **File**: `routes/dither-kit.tsx` (`ssr: false`). Component inline `DitherKitDocs`.
- **Auth**: gated at root; demo-only.
- **Reachability**: **ORPHAN** — nothing links here.
- **Shell**: **standalone** (own docs layout w/ `dialkit`, theme toggle; no
  DashboardLayout).
- **DOM**: documentation page for the `#/components/charts/dither-kit` primitives.
- **DATA**: **DERIVED** — local example data.
- **Residue**: **dev/demo residue** (docs/showroom).

> Note: `routes/agents.md` is **not a route** — it's an AI-agent scope doc for
> `routes/**`; absent from `routeTree.gen.ts`.

---

## SUMMARY SECTIONS

### Nav map
Topbar (`dashboard-topbar.tsx`), 8 items:
| Label | Target |
|---|---|
| Queue | `/` |
| Events | `/events` |
| Rules | `/rules` |
| Workflows | `/workflows` |
| Moderation | `/moderation` |
| Automod | `/automod` |
| Analytics | `/acme/tripwire/analytics` (hardcoded org/repo) |
| Integrations | `/acme/integrations/github` (hardcoded org) |

MobileFooter repeats 4: Queue, Automod, Analytics, Integrations.
UserMenu dropdown: Profile → `/profile/$userHandle` (MODERATOR.login), Settings
(no-op), Log out → `/login`.

Link tree (in-app):
- `/` DitherStatCards → `/analytics?source=moderation&metric=…`
- `/automod` DitherStatCards + `/analytics` back-link ↔ `/automod`
- `/analytics` back-link → `/` or `/automod`; metrics sheet → per-thread analytics
- `RepoCrumbs` → `/$org/repos` → `/$org/$repo/analytics`
- `RepoTabs` → `/$org/$repo/{analytics,issues,pulls}`
- issues/pulls index → detail → analytics thread pages, and back "View conversation"
- `/moderation` → `/runs/$runId`

External deep-link:
- **PR comment button → `${appUrl}/runs/${runId}`** — built in
  `apps/worker/src/jobs/pr-surface.ts:90`, rendered by `renderCommentBody`
  (`packages/forge-github/src/actions/comment.ts`). This is the primary way a
  contributor reaches `/runs/{id}` (public, no session).

### Orphans (reachable by URL, linked from nowhere)
- **`/dither-charts`** — dev chart showcase.
- **`/dither-kit`** — dev chart docs.
- **`/$org/repos`** — near-orphan: only reachable via a `RepoCrumbs` breadcrumb
  (which itself only renders once you're already inside a repo route); no
  top-level nav entry.

### Mock inventory
All seeds live in `apps/web/src/lib/*` (there is no `src/mocks/**` directory).
Each is consumed by exactly one `*.functions.ts`:
| Mock file | Consumer fn | Routes served | Real source that could replace it |
|---|---|---|---|
| `mock-data.ts` (`seedFlaggedItems`, `seedStats`) | `moderation.functions.ts` | `/` queue; `seedStats` is only the **fallback** for the real stats header | Queue: `moderation_items` (already real in `/moderation`). Stats: already real (`insightServices.getHomeStats`) — mock is fallback only |
| `log-mock-data.ts` (`seedLogEntries`) | `log.functions.ts` | `/` log view | No real moderation-log service yet |
| `automod-mock-data.ts` (`seedAutomodRules`, `seedAutomodStats`) | `automod.functions.ts` | `/automod`, `counts.automod` on most pages, `/analytics` automod source | Partial: `/rules` real insights (`run_steps`/`run_actions`) — different shape |
| `analytics-events.ts` (`seedAnalyticsEvents`) | `analytics-activity.functions.ts` (automod branch), `analytics-events.tsx` | `/analytics` when `source=automod` | Moderation branch already real (`listRecentDecisions`/`listRecentRuns`) |
| `repo-analytics-mock-data.ts` (`seedRepoAnalytics`) | `repo-analytics.functions.ts` | `/$org/$repo/analytics` (+ issues/pulls thread analytics, detail sheets) | None yet |
| `repo-content-mock-data.ts` (`seedRepoContent`) | `repo-content.functions.ts` | `/$org/repos`, issues/pulls index + detail | Partial: `repos` table has repo list (real in `/rules`); thread/comment content has no real source |
| `contributor-mock-data.ts` (`seedContributorProfile`) | `contributor.functions.ts` | `/profile/$userHandle` | None (would be GitHub API + moderation store) |
| `integrations-mock-data.ts` (`seedGithubIntegration`) | `integrations.functions.ts` | `/$org/integrations/github` | Partial: `repos` table (installation sync) |

### Layout drift
- **`/runs/$runId`** renders **two ways** — standalone (public) vs DashboardLayout
  (full). Intentional per §10, but it's the sole dual-shell route.
- **Standalone (no shell)**: `/login`, `/dither-kit`, and the public branch of
  `/runs/$runId`.
- **`/dither-kit`** uses its own docs chrome (`dialkit`) + a private theme toggle,
  duplicating the topbar's `ThemeToggle` behavior.
- **Page-header pattern** is consistent across shelled pages (`<header> h1 + subtitle`,
  `max-w-4xl`/`3xl` column) — except `/analytics` and `/$org/$repo/analytics`,
  which lead with breadcrumbs/back-links instead of an `h1`.
- **`MODERATOR`** is a hardcoded fixture used as the "signed-in user" in the shell
  on every page — even the real pages show a fake identity in the topbar.
- **Convention drift (not visual)**: `/rules` and `/workflows` have no
  `*.query.ts` file (query options declared inline), unlike the other domains'
  `<domain>.query.ts` split per §9.

### Dead code candidates (grep-confirmed zero inbound `<Link>`/navigate)
- **`/dither-charts`** (`routes/dither-charts.tsx`) — zero inbound references.
- **`/dither-kit`** (`routes/dither-kit.tsx`) — zero inbound references.
  (Both still ship a route in `routeTree.gen.ts`, so they're live URLs, just
  unlinked dev showrooms.)
- Not dead, but **superseded/overlapping**: the mock `QueueList` on `/` duplicates
  the real `/moderation` queue; mock `/automod` overlaps the real `/rules`;
  `seedStats`/`seedAnalyticsEvents` are now fallback-only behind real sources.
- `routes/agents.md` — not code, an agent-scope doc (harmless, not a route).
