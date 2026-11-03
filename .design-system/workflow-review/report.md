# Workflow push review surface

Workflow push review now uses the semantic overview page contract: proposal facts and status lead, each workflow is a semantic section, the code diff remains the primary evidence, and the decision bar stays reachable at the bottom of an open review.

## Contract changes

- Loaded and pending states share `Page`, `PageHeader`, and `PageBody` hierarchy.
- Author, workflow count, repository, and time use page metadata instead of a page-local subtitle layout.
- Each proposed workflow uses semantic `Section`, `SectionHeader`, and `SectionBody` composition.
- Status badges remain separate from workflow names and wrap independently.
- The decision footer owns sticky placement, expiry copy, and action grouping through an app semantic layout role.
- Not-found content has a level-one page title without nesting a second `main` landmark.
- Issue, outcome, code-note, and hostile workflow-name text wrap without widening the document.

## Browser matrix

| State | Result | Evidence |
| --- | --- | --- |
| Pending | Pass at 1280px and 390px; Decline and Accept changes remain enabled and visible | `pending-{1280,390}.{png,aria.yml}` |
| Stale | Pass at 390px; out-of-date explanation is visible and decision actions are absent | `stale-390.{png,aria.yml}` |
| Accepted | Pass at 1280px; accepted outcome links to the saved workflow and actions are absent | `accepted-1280.{png,aria.yml}` |
| Rejected | Pass at 390px; declined outcome is visible and actions are absent | `rejected-390.{png,aria.yml}` |
| Missing or permission-denied | Pass at 390px with `Push not found` and a route back to workflows | `not-found-390.{png,aria.yml}` |
| Hostile workflow name/code | Pass at 320px with 100 unbroken characters plus Unicode, emoji, and RTL text; the document remained 320px wide and the code diff retained its own overflow behavior | `hostile-320.png` |

A disposable pending proposal was declined through the browser. The mutation completed, the review changed to `Declined by Dev owner`, and both decision actions disappeared. Accept/reject persistence and draft promotion are additionally covered by database integration tests.

## Verification

- Web typecheck passed.
- 28 focused review-state, semantic-skeleton, and agent-work integration tests passed in the final focused runs.
- Dependency boundaries passed.
- Browser captures produced no document overflow or reproducible console/page errors.
- The review component family decreased from raw spacing `15`, typography `7`, and color `8` to zero design-system diagnostics.
- The exact repository baseline decreased to raw color `481`, spacing `626`, and typography `314`; other counts did not rise.
