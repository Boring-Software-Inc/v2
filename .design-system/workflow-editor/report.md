# Workflow editor migration report

## Scope

Migrated the workflow editor shell, header, loading frame, canvas frame, empty canvas, and route-level not-found state onto app-owned semantic layout roles backed by the Glaze contract.

The editor remains a full-height workspace rather than adopting the task-page composition used by collection and review routes. Domain-specific canvas, sidebar, node, connection, save, permission, and draft behavior remains in the web application.

## Contract changes

- Replaced page-local Tailwind geometry in the editor frame, route skeleton, and header with closed `data-layout-role` contracts in `apps/web/src/design-system/layout-contract.css`.
- Restored the editor's viewport-relative minimum height and the `SkeletonSwap` flex relationship through semantic CSS rather than the exported `PAGE_FRAME` utility string.
- Replaced the header back control's anchor-with-button-role composition with a semantic router link and a 44px target.
- Moved React Flow visual variables from an inline style object into the semantic canvas role.
- Replaced the not-found title with the shared semantic `PageTitle` and retained a destination-based back link to the workflow collection.
- Kept responsive editor actions intact: desktop actions remain visible at wide sizes, while the narrow action menu exposes workflow activation, arrange, and Markdown copy where applicable.

## Behavioral verification

Verified against the disposable dev scenarios on `localhost:3001`:

- Owner, populated canvas at 1280px.
- Owner, populated canvas and code view at 390px with no document-level horizontal overflow.
- Narrow action menu in canvas mode: activation, auto-arrange, and Markdown copy.
- Narrow action menu in code mode: activation.
- Member/read-only editor: read-only badge present; save and rename controls absent.
- Invalid workflow: `2 to fix` problem panel opens and exposes both blocking fixes.
- Unsaved graph change: save becomes available and back navigation opens the leave-without-saving alert dialog.
- Save pending state: `Saving` appeared and the save action returned to disabled after completion.
- Route not found: semantic level-one heading and scoped `/dev-owner/active-webapp/workflows` back link.
- Loading frame: editor skeleton is visible before the resolved editor mounts.

The current editor implementation does not expose a distinct save-conflict UI state; the inventory's generic `conflict` entry was not fabricated for this migration.

## Diagnostics

Editor-directory design-system diagnostics changed from:

| Rule | Before | After |
| --- | ---: | ---: |
| raw color | 72 | 63 |
| raw spacing | 85 | 69 |
| arbitrary Tailwind values | 8 | 8 |
| raw typography | 32 | 26 |
| inline visual styles | 9 | 8 |

The remaining diagnostics are concentrated in node cards, sidebar/property editors, connection overlays, and specialized canvas controls rather than the migrated route shell.

## Evidence

- `loading-390.png`
- `editor-1280.png` and `editor-1280.aria.yml`
- `editor-390.png` and `editor-390.aria.yml`
- `code-390.png`
- `member-390.png` and `member-390.aria.yml`
- `issues-1280.png`
- `issues-open-1280.png`
- `unsaved-1280.png`
- `unsaved-dialog-1280.png`
- `saving-1280.png`
- `not-found-390.png` and `not-found-390.aria.yml`
