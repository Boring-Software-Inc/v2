# Route redesign and antislop cleanup plan

## Context

The semantic UI contract and `@tripwire/ui` package are complete, but the route-level client components still contain legacy page-local composition, raw visual choices, and existing anti-slop findings. The next phase should migrate the actual product surfaces onto the package-owned contract, polish the route experience as coherent component families, and clean the non-UI anti-slop backlog without mixing either stream into the design-system foundation work.

The current checkout is `semantic-ui-contract` and has a large dirty working tree: roughly 1,230 modified, 34 deleted, and 28 untracked non-skill paths, plus unrelated `.agents/skills/**` changes. Many are older or line-ending-wide changes and cannot be assumed to belong to this effort. A safe two-lane workflow requires a committed semantic-system baseline before isolated worktrees can branch from the same point, using an explicit path manifest and staged-diff review rather than broad staging.

The accepted `.design-system/taste.md` is stale and still names Quartz, while the completed architecture explicitly restored Glaze. It must be superseded before visual redesign work begins.

## Resolved decisions

- Antislop runs **during** planning and implementation.
- The lead may create a clean semantic-system baseline commit, excluding unrelated `.agents/skills/**` changes.
- The delegated cleanup lane covers frontend findings in `apps/web/**`, `packages/ui/**`, and directly related frontend enforcement; backend/domain findings are out of scope.
- Moderation is the pilot family because it is the daily repo surface and exercises collection controls, permissions, writes, dialogs, analytics, onboarding, and empty/loading/error/populated states.
- The route redesign covers all web route clients, but fans out in risk-ordered component-family waves rather than one whole-app rewrite.
- Redesign depth is **UX polish**: hierarchy, grouping, labels, helper copy, and interaction presentation may change; permissions, route capabilities, data flow, server writes, and core product behavior remain fixed unless a separately documented bug is confirmed.

## Approach

Use two isolated child branches/worktrees from one committed semantic-system baseline:

```text
semantic-ui-contract (clean committed baseline)
├── product-route-redesign    route/component-family redesign
└── antislop-cleanup          non-UI lint cleanup

antislop-cleanup ──merge──> product-route-redesign
product-route-redesign ──merge──> semantic-ui-contract
```

The lead session owns branch integration and product direction. A delegated cleanup agent owns only planted/current anti-slop findings outside route UI files. Route redesign proceeds by shared component family, not by restyling each route independently. One representative route family receives three development-only variants on a single structural axis; the user chooses a direction before fan-out.

Route files should remain thin TanStack route declarations. Most redesign work belongs in `apps/web/src/components/**`, package-owned semantic additions belong in `packages/ui/**`, and feature code continues consuming stable facades rather than Glaze implementation paths.

The first shared migration target is the repeated route shell currently expressed as `px-4 py-6 md:px-8 md:py-10` plus a centered width container. It appears across moderation, rules, workflows, analytics, activity, organization, run, settings, and admin surfaces. That geometry should move once into package/application page molecules before route families fan out. Moderation’s page title, supporting text, queue action row, status icon tones, truncation note, region-lock presentation, and skeleton geometry are current examples of caller-owned visual decisions that the new contract should absorb. Copy and grouping may be tightened, but approving/blocking, permission gates, setup behavior, query invalidation, analytics access, and server write payloads stay unchanged.

## Files to modify

Critical areas, refined after route inventory:

- `packages/ui/**` — only missing domain-free semantic primitives or molecules proven by multiple route families.
- `apps/web/src/components/layouts/**` — application shells and product-specific composition.
- `apps/web/src/components/{organizations,moderation,rules,workflows,analytics,activity,responses,runs,settings,admin,auth,setup}/**` — route client components and their state-specific skeletons.
- `apps/web/src/routes/**` — only route wiring, metadata, search schemas, or lazy boundaries required by the redesigned clients.
- `apps/web/src/design-system/**` — semantic enforcement and application-specific contract extensions.
- `scripts/oxlint/**`, `.oxlintrc.json`, and anti-slop baseline files — cleanup lane only where findings prove a rule defect or baseline reduction.
- `.design-system/**` — direction, route/state inventory, decisions, captures, rollout evidence, and per-surface verdicts.

Protected from both lanes:

- Unrelated `.agents/skills/**` working-tree changes.
- Backend/domain behavior unless a route redesign exposes a confirmed data bug.
- Glaze implementation internals unless a repeated primitive defect requires one centralized fix.

## Reuse

- Package contract: `packages/ui/src/typography.tsx`, `packages/ui/src/layouts.tsx`, and `packages/ui/src/styles/**`.
- Stable web facades: `apps/web/src/design-system/**` and `apps/web/src/components/layouts/{page,section}.tsx`.
- Product shell: `apps/web/src/components/layouts/dashboard-layout.tsx` and adjacent rail/topbar/navigation components.
- Existing state audits: `scripts/check-component-states.tsx` and `scripts/check-ui-contract.ts`.
- Existing route skeletons and real query hooks in each feature component directory; preserve their loading, empty, error, permission, and populated behavior.
- Moderation pilot data/behavior: `apps/web/src/components/moderation/moderation-page.tsx`, `moderation-queue.tsx`, `moderation-page-skeleton.tsx`, and `moderation-collection.ts`.
- Shared collection behavior: `apps/web/src/components/collection/collection.tsx` and `apps/web/src/hooks/use-collection.ts`.
- Existing design-system Oxlint rules and exact baseline under `scripts/oxlint/design-system/**` and `.design-system/design-system-lint-baseline.json`.
- Existing anti-slop changed-line gate: `scripts/lint-slop-changed.ts`.

## Steps

- [x] Confirm antislop mode, route scope, visual direction process, and authorization to commit the completed semantic-system baseline.
- [x] Build an explicit semantic-baseline path manifest from the completed plan’s known files; classify every candidate diff as semantic implementation, verified facade-only import rewrite, or unrelated; stage only the first two classes, review the staged diff, and create the authorized baseline commit without broad `git add` or any `.agents/skills/**` paths.
- [ ] Supersede the stale Quartz taste document with the accepted Glaze/product direction and record the branch/worktree roles.
- [ ] Create isolated `product-route-redesign` and `antislop-cleanup` worktrees from the same baseline commit.
- [ ] Inventory all route client surfaces by component family, route, state, writes, responsive risk, and current semantic/Oxlint/anti-slop findings.
- [ ] Delegate the non-route frontend anti-slop lane with strict path ownership and the current 139-diagnostic inventory; reserve route-family component directories for the redesign lane, fix shared frontend/lib findings in the cleanup lane, and reduce findings rather than suppressing rules.
- [ ] Capture pre-redesign baselines for moderation in light/dark, narrow/intermediate/wide widths, setup-only/loading/empty/error/populated/read-only/decision-pending states, dialog open, analytics-at-rest, and 200% text zoom.
- [ ] Build three development-only moderation variants on one explicit composition/density axis; keep decision behavior, filters, setup progress, queue semantics, and analytics data identical; review them in the real dashboard shell and obtain the user’s selection.
- [ ] Promote the selected direction into shared route-family composition and remove the variant harness completely.
- [ ] Migrate product routes by shared family: moderation pilot; collection/index pages (organization home, rules, workflows, activity, responses); detail/review pages (runs and workflow review); editor/configuration pages; analytics/data pages; settings/forms; then utility/auth/admin surfaces.
- [ ] For each family, add missing domain-free APIs to `@tripwire/ui` only after proving reuse; keep domain-specific composition in web and lower exact visual lint baselines in the same change.
- [ ] Verify every migrated family through reachable loading, empty, error, populated, disabled, permission, overflow, keyboard, reduced-motion, and responsive states; run hostile-content checks where lists/forms/user content changed.
- [ ] Review and merge the verified `antislop-cleanup` lane into `product-route-redesign`, resolving conflicts at shared enforcement files rather than route UI files.
- [ ] Run a final antislop pass on the redesigned branch, fix only accepted findings, and prove both anti-slop and design-system ratchets shrink.
- [ ] Run a risk-proportional independent review, production build, route status sweep, browser audits, and final before/after captures.
- [ ] Merge `product-route-redesign` back into `semantic-ui-contract` only after the integration commit passes the full verification matrix.

## Verification

Per family:

- Package and web typechecks.
- Relevant Bun component/query tests.
- Biome and Oxlint on edited files.
- `scripts/check-boundaries.ts`.
- Design-system fixture suite and exact baseline checker.
- Anti-slop changed-line lint against the actual child-branch base commit, never the stale local `main` ref. (`main` currently reports 1,912 changed-line violations because it predates the branch’s staging base.)
- Browser checks at 320/390px, 768px, and 1280px in light and dark themes.
- 200% text zoom, keyboard/focus, reduced motion, console/network errors, and horizontal overflow.
- State coverage for loading, empty, error, populated, disabled/pending, permission variants, and long/hostile content.
- Before/after captures with every intentional difference documented.

Integration:

- Frozen lockfile install.
- Production Vite/Nitro build; separately report the known Sentry instrumentation issue if it persists.
- Full component-state and route-contract audits.
- Dependency-boundary check.
- Exact anti-slop and design-system baseline reductions.
- Independent diff review using the real merge base.
- No remaining variant query parameters, harness imports, temporary fixtures, or cross-worktree artifacts.
