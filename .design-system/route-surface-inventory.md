# Route client surface inventory

Baseline commit: `3fbde42d`

## Enforcement snapshot

`NODE_OPTIONS=--experimental-strip-types ./node_modules/.bin/oxlint apps/web packages/ui --format json` reports 1,773 frontend diagnostics:

- 1,634 design-system findings: spacing 691, color 504, typography 339, arbitrary Tailwind 65, inline visual style 35, direct implementation imports 0.
- 139 anti-slop findings: runtime `typeof` 57, unsafe dictionaries 29, known-value widening 23, unknown parameters 21, conditional empty-object spreads 7, chained assertions 2.
- `packages/ui/**` contributes zero findings.
- Cleanup ownership: 46 strict non-route findings, 21 save-queue/shared seams deferred until their route consumers migrate, and 72 route-family findings owned by redesign.

Design-system / anti-slop findings by primary component family:

| Family | Design system | Anti-slop |
| --- | ---: | ---: |
| admin | 277 | 0 |
| workflows | 244 | 23 |
| runs | 193 | 0 |
| responses | 164 | 1 |
| organizations | 152 | 3 |
| rules | 109 | 18 |
| agents | 57 | 3 |
| setup | 47 | 2 |
| common | 47 | 0 |
| forges | 33 | 0 |
| auth | 32 | 0 |
| mascot | 32 | 0 |
| layouts | 28 | 1 |
| account | 26 | 0 |
| analytics | 25 | 0 |
| activity | 21 | 1 |
| moderation | 19 | 0 |
| feedback | 19 | 0 |
| code | 18 | 0 |
| dev | 16 | 0 |
| rules-params | 12 | 10 |
| settings | 7 | 0 |
| tabs | 6 | 5 |
| save-queue | 3 | 21 |
| shared lib/routes/scripts | 33 | 51 |

## Product route clients

“Writes” names product effects that must remain payload- and permission-equivalent. Every data surface also has the global route error boundary even where the row only names local states.

| Family | Routes and client components | Reachable states | Writes | Responsive risk |
| --- | --- | --- | --- | --- |
| Moderation pilot | `/$org/$repo/moderation` → `ModerationPage`; `ModerationQueue`; `ModerationPageSkeleton` | setup pending; setup-only; queue loading/error/empty/filtered-empty/populated/truncated; moderator read-only; decision pending/success/failure; block dialog; analytics loading/at-rest/data/permission-locked; backfill | POST approve/deny moderation item; query invalidation and audit event | High: row actions, long titles/reasons, filters, chart, dialog, setup checklist |
| Activity collection | `/$org/$repo/activity` → `ActivityPage`; skeleton, filters, grouped rows | loading/error/empty/filtered-empty/populated; backfill; long metadata | none on primary feed | High: grouped rows, filters, long forge metadata |
| Analytics data | `/$org/$repo/analytics` → `AnalyticsPage`; charts/events/skeleton | loading/error/empty/at-rest/populated; metric/date filters; permission gates | none | High: chart/table density, legends, narrow filters |
| Rules collection/configuration | `/$org/$repo/rules` → `RulesPage`; rule cards/library/packs/skeleton; `/$org/$repo/moderation_/replay` → `RulesReplayPage` | loading/error/empty/populated; installed/uninstalled; enabled/disabled; invalid params; unsaved/saving/save failure; permission variants; replay loading/result | install/update rules and parameters; save queue; replay action | Critical: form sentences, nested controls, long evidence, shared save queue |
| Responses configuration | `/$org/$repo/responses` → `ResponsesPage`; builder, previews, skeleton | loading/error; valid/invalid blocks; unsaved/saving/save failure; redaction/GIF search states; narrow preview | save response configuration and redaction settings | Critical: drag/drop, editors, preview, user content, shared save queue |
| Workflow collection | `/$org/$repo/workflows/` → `WorkflowsGridPage`; skeleton | loading/error/empty/filtered-empty/populated; draft/live; permission variants | create, duplicate, archive/delete, publish-related actions | High: collection actions, long names, card/grid reflow |
| Workflow editor | `/$org/$repo/workflows/$workflowId` → `WorkflowEditorPage`; canvas/editor/sidebar/properties/skeleton | loading/error; graph empty/populated/invalid; selected node variants; unsaved/saving/conflict; permission/read-only; problems; zoom; narrow side panel | save workflow graph/settings, publish/draft operations | Critical: canvas, keyboard, DnD, panels, overlays, many node types |
| Workflow review | `/$org/$repo/workflows/review/$pushId` → `WorkflowPushReviewPage`; skeleton | loading/error; pending/accepted/rejected/stale; long diff/content; permission variants | accept/reject push review where authorized | High: review decisions, code/diff overflow |
| Run detail | `/runs/$runId` → `RunPage`; chain/evidence/AI trace/skeleton | loading/error/not-found; live/pending/completed/failed/superseded; public/private; long evidence/code; action availability | approved run actions exposed by the page | Critical: mixed timeline/evidence/code, live updates, public route |
| Organization home | `/$org/home` → `OrgHomePage`; digest/repository collection/skeleton | loading/error/no repos/filtered-empty/populated; personal/team; setup/install states; permission variants | arm/install/connect and digest actions where exposed | High: mixed overview and collection, long repository names |
| Organization analytics | `/$org/analytics` → `OrgAnalyticsPage`; skeleton | loading/error/empty/populated; permission lock | none | Medium-high: chart density and responsive controls |
| Settings shell | `/$org/settings` → `SettingsLayout`; skeleton/nav | loading/error; personal/team; permission-filtered navigation; narrow navigation | none in shell | High: responsive nav/content relationship |
| Settings pages | account, agents, billing, connections, general, members, redaction, roles under `/$org/settings/*` via `SettingsPages` | per-page loading/error/empty/populated; field invalid/disabled/pending; dialogs; admin/member/personal variants; long identities | profile/org/member/invite/role/connection/redaction/billing changes according to page | High: forms, destructive actions, tables/rows, permissions |
| Install/onboarding | `/onboarding/setup` → `InstallSetupPage`; setup components/skeleton | loading/error; provider selection; waiting/success/refusal/retry; no access | create/confirm forge installation and connection | High: multi-provider async flow and recovery |
| Invitation | `/invite/$token` → `InvitePage`; skeleton | loading/invalid/expired/already-member/ready/accepting/success | accept invitation | Medium: one decision flow and error recovery |
| No-organization entry | `/` → `NoOrgsPage`; skeleton | loading; no org; pending access; create/connect paths | create organization or begin connection | Medium |
| Account redirect | `/account` redirects to scoped account settings | redirect only | none | Low |
| Agent consent/device | `/consent` → `AgentConsentPage`; `/device` → `AgentDevicePage`; shared request skeleton | loading/error/expired/denied/approved; scope list; code entry; pending | approve/deny agent grant and device authorization | High: security decisions, codes, expiry, focus |
| Login/access | `/login` → `LoginPage`; skeleton; `/queue` → queue page | provider available/unavailable; webview; FAQ; dev disclosure; signed-out; pending access | OAuth start; dev scenario only on loopback | Medium-high: public responsive and disclosure states |
| OAuth utility | `/oauth/popup-callback`; `/oauth/waitlist` | pending/success/refused/retry/malformed return | OAuth completion/resume | Medium: browser boundary and recovery |
| Admin overview | `/admin/` → `AdminHomePage`; skeleton | loading/error/populated | none | Medium |
| Admin economics | `/admin/economics` → `EconomicsPage`; skeleton | loading/error/empty/populated; date/range | economics actions already exposed | High: dense data |
| Admin installations | `/admin/installations` → `AdminInstallationsPage`; skeleton | loading/error/empty/populated/paginated | administrative installation actions | High: table and narrow overflow |
| Admin organizations | `/admin/orgs` → `AdminOrgsPage`; skeleton | loading/error/empty/populated/expanded/search/paginated | member role and org administration actions | High: expandable rows and tables |
| Admin repositories | `/admin/repos` → `AdminReposPage`; skeleton | loading/error/empty/populated/search/filter/paginated | administrative repo actions | High: table and filters |
| Admin users | `/admin/users` → `AdminUsersPage`; user sheet/skeleton | loading/error/empty/populated/search/filter/selected user; action pending/failure | staff access, flags, moderation, impersonation, destructive actions | Critical: dense table, sheet, high-risk writes |
| Mascot/game utility | `/mascot` → `MascotPage`; `/game` → `RunnerPage`; skeletons | loading; interactive controls; reduced motion; keyboard/pointer variants | local interaction only | Medium: canvas/animation/mobile controls |

## Layout, scope, and redirect routes

- `/$org` → `OrgScopeOutlet` resolves organization scope.
- `/$org/$repo` → `RepoLayout` owns repository navigation and nested route context.
- `/$org/$repo/` redirects to moderation.
- `/$org/`, `/$org/settings/`, `/$org/settings/settings`, `/account`, `/activity`, `/analytics`, `/moderation`, `/rules`, `/workflows`, `/admin`, and `/onboarding/` are redirects or aliases and should not acquire presentation logic.
- `__root.tsx` owns global auth/access gates, theme, providers, route progress, error/not-found shells, and design-system styles.

## Shared migration seams

1. Repeated page padding/width/header geometry across moderation, rules, workflows, analytics, activity, organizations, runs, settings, and admin.
2. Collection controls plus loading/error/empty/filtered/populated composition.
3. Responsive item rows and action groups.
4. Page/section skeletons that currently choose widths and spacing locally.
5. Permission-locked regions such as analytics, currently expressed through visual blur and page-local overlay geometry.
6. Save-queue state shared by rules and responses; its 21 anti-slop findings stay deferred until both consumers can migrate together.
7. Tables across admin and analytics.
8. Dialog/form action rows and destructive confirmations.

## Migration order

1. Moderation variants and selected pilot.
2. Shared collection/index family: organization home, activity, workflows, then rules and responses where their save/edit seams permit.
3. Run detail and workflow review.
4. Workflow editor and configuration-heavy surfaces.
5. Analytics and table/data families.
6. Settings forms and organization management.
7. Public auth/onboarding/agent flows.
8. Admin and utility surfaces.
