# Route redesign: staging verification

Target: https://staging.tripwire.sh. Use test accounts and a sandbox repository for actions. Do not use production data or delete anything to exercise a state.

This release combines accepted redesign code through `eac23978` with staging's existing Databuddy fixes through `399ac6b1`. The operator ended the remaining cleanup scope: no more workflow UI changes, no unfinished connections or response-preview migration. Zero-lint cleanup and the full automated browser matrix are deferred, not passed. The accepted inventory still has940 design-system findings and zero anti-slop findings.

## First pass

- [ ] **Sign-in and access:** sign in, refresh, sign out, and open a protected deep link while signed out. After signing in, return to the intended page. A non-admin must not gain admin access.
- [ ] **Navigation:** switch organization/repository, open a detail page from a list, then use both app Back and browser Back. Check that scope, filters and return destinations remain sensible.
- [ ] **Layout:** try desktop and phone widths in light/dark mode. Check navigation, dialogs, long names, tables and empty states for clipping, unreadable text or unreachable controls. Try keyboard Tab/Enter/Escape and increased text size.
- [ ] **Collections:** browse organization home, repositories, activity and workflows. Exercise available search/filter/sort controls and open both populated and naturally empty views.
- [ ] **Moderation:** on a sandbox item, inspect evidence and perform an intended approve/deny action. Confirm the result persists after refresh and the item's run agrees with the action. Check read-only access with a non-admin.
- [ ] **Run details:** open a run from the dashboard and its public link signed out. Expand evidence/reasoning, follow permitted links, and confirm private information stays redacted.
- [ ] **Rules and responses:** change a harmless sandbox setting, save, refresh and confirm persistence. Check validation feedback and the existing check/comment/review/run-page previews where available.
- [ ] **Settings:** check each settings page, connections, save feedback and unsaved-change warnings. Navigate away and back; confirm successful saves persist and permissions remain correct.
- [ ] **Admin:** check users, the user sheet, installations and operational views. If testing flags, use a test user; check pending/success/failure feedback, agreement with Databuddy and persistence after refresh, then restore the intended value. The Databuddy profile link must use the staging website.
- [ ] **Agents, if used:** exercise a staging device authorization and check approval/cancellation/expiry, then verify the intended account/repository access. This is not a new npm CLI release.
- [ ] **Workflows—smoke check only:** open the existing workflow list/editor/review and verify navigation/loading. No further workflow polish is part of this release; do not modify a live workflow just to test it.
- [ ] **Runtime:** watch for fatal console errors, hydration failures or failed application requests. Confirm analytics has no SRI error or duplicate loader. Staging website ID: `a512e6bc-385f-4b92-bceb-0692519edfc7`.

## If something fails

Record the URL, account role, viewport/theme, exact steps, expected versus actual result and a screenshot. Include any relevant failed request or console error. Do not include cookies, tokens or private contributor data.

## Pre-push evidence

All workspace typechecks, boundary check, merge-resolution Biome and393 selected regression tests passed (1 skipped,1,286 assertions across37 files). The full production build passed after a disposable dependency-layout link exposed the already-installed Sentry package at the existing wrapper's expected path; the first failed build is retained. No dependency, lockfile or build-script change was made for that correction. The two manual merge resolutions received an independent bounded review. No fresh browser pass or full-suite/zero-lint claim is made; staging verification remains open.
