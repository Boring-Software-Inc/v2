# Moderation route baseline

Captured on the real `/$org/$repo/moderation` route before the route redesign. The existing development-scenario system was sufficient, so no temporary component workbench or production seam was added.

## State coverage

| State | Scenario / method | Evidence |
| --- | --- | --- |
| Populated, admin | `Team org admin` | `populated-admin-1280-{light,dark}.{png,aria.yml}`, `populated-admin-390-{light,dark}.{png,aria.yml}` |
| Loading | Held `listModerationQueue` pending in the disposable browser | `loading.{png,aria.yml}` |
| Empty queue | Cleared pending moderation items for the disposable seeded repo, captured, then reapplied the seed | `empty-queue.{png,aria.yml}` |
| Error | Returned a disposable 503 from `listModerationQueue` | `error.{png,aria.yml}` |
| Decision pending | Held `decideModeration` pending after approving the first item | `decision-pending.{png,aria.yml}` |
| Confirmation open | Opened the first block confirmation without submitting it | `block-dialog-open.{png,aria.yml}` |
| Setup only | `Repo with no events` | `setup-only.{png,aria.yml}` |
| Read-only member | `Member, not admin`; decision controls are present and disabled | `member-current-capabilities.{png,aria.yml}` |
| Permission-limited moderator | `Moderator, human review only`; decisions are enabled and analytics are locked | `moderator-analytics-locked.{png,aria.yml}` |

The route does not expose a separate stale-refetch branch. Decision pending is the reachable mixed state where one write is unresolved while the populated collection remains visible.

## Baseline observations

- Desktop composition is centered inside a second rounded page frame, producing a frame-within-frame hierarchy.
- The queue and analytics panel carry equal visual weight even though decisions are the primary task.
- Queue rows compress title, contributor, timestamp, evidence, and two actions into one line; evidence truncates early on desktop.
- At 390px the desktop row composition remains horizontal. Titles and evidence collapse to fragments while both action buttons retain full width.
- The repo navigation is a single horizontal strip and visibly runs beyond the mobile viewport.
- Loading, empty, error, pending, setup, confirmation, read-only, and analytics-locked states are implemented and reachable.
- The error state preserves analytics while isolating the failed queue query.
- The setup-only route is a distinct onboarding surface and must not be forced into the populated queue composition.

## Capture conditions

- Local disposable database and dev identities only.
- Browser viewport: 1280×900 desktop and 390×844 mobile.
- Light and dark populated states captured.
- Screenshots are full-page; accessibility evidence is the real rendered main-region snapshot, except the confirmation capture, which records the active `alertdialog` from the body because the background is inert.
- The seeded moderation rows were restored after the empty-queue capture.
