# Selected moderation route verification

The user-selected **Focus** direction is promoted on the production moderation composition. The development picker, `__variant` search parameter, and rejected variant code are gone.

## State matrix

| State | Result | Evidence |
| --- | --- | --- |
| Populated admin | Pass at 1280px and 390px, light and dark | `populated-admin-*.{png,aria.yml}` |
| Loading | Pass; queue skeleton preserves the selected measure and row/action rhythm | `loading.{png,aria.yml}` |
| Empty queue | Pass; empty action and analytics remain reachable | `empty-queue.{png,aria.yml}` |
| Queue error | Pass; alert names the failure and exposes `Load items again` while analytics remains available | `error.{png,aria.yml}` |
| Decision pending | Pass; all 12 decision controls disable while the write is unresolved | `decision-pending.{png,aria.yml}` |
| Block confirmation | Pass; alert dialog is labelled, Escape closes it, and focus returns to the trigger | `block-dialog-open.{png,aria.yml}` |
| Setup only | Pass; onboarding remains its own page state | `setup-only.{png,aria.yml}` |
| Read-only member | Pass; all 12 decision controls are present and disabled | `member-current-capabilities.{png,aria.yml}` |
| Moderator | Pass; decisions remain enabled and the analytics region states the permission limit | `moderator-analytics-locked.{png,aria.yml}` |

## Responsive and hostile-input checks

- 320px: no document overflow; queue rows wrap evidence and actions without detaching controls from their review item.
- 390px: full action labels remain visible; title, actor, time, and evidence use multiple lines before truncation.
- 200% zoom at 1280px: no document overflow and decision actions remain inside the queue.
- Reduced motion: verified through the browser context; the route adds no motion of its own.
- Hostile seeded item at 320px: 80-character unbroken title, Unicode/emoji/RTL actor, and a 300-character URL reason remained inside the row. See `hostile-long-320.png`.
- Search field: 80-character unbroken text, Unicode/emoji/RTL, HTML-looking text, and whitespace-only input produced no overflow, markup execution, or console error.
- Keyboard: Enter opens the first block confirmation; Escape closes it and restores focus to the trigger.
- Console: no page or console errors in the hostile-input and keyboard run.

## Static verification

- Biome passed for the moderation family, route, and layout contract.
- Web typecheck and dependency-boundary checks passed.
- The exact design-system baseline passed at `501 / 683 / 335` for raw color / spacing / typography.
- Changed-line anti-slop and design-system lint passed against `3fbde42d`.
- Vite and Nitro production compilation completed. The subsequent known Sentry instrumentation wrapper failed because `node_modules/@sentry/server-runtime-injection/build/esm` was unavailable; no product compilation error preceded it.

## Observed shared-shell issue

At 320px the repository navigation is a horizontally scrollable strip, so later destinations are partially clipped until the user swipes. This predates the moderation redesign and is common to every repository route; it remains a shared-shell hardening item for the route-family migration rather than a moderation-specific regression.
