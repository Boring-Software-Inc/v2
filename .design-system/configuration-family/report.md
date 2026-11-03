# Configuration family — rules and responses

Rules and responses now share the semantic page contract while preserving their distinct tasks. Rules uses the accepted Focus measure; responses uses the overview measure for its three-part builder workspace. Save-state remains part of the page header rather than becoming a floating or page-local control.

## Browser matrix

| Route/state | Result | Evidence |
| --- | --- | --- |
| Rules, admin populated | Pass at 1280px and 390px; create, tabs, card controls, and responsive wrapping remain available | `rules-admin-{1280,390}.{png,aria.yml}` |
| Rules, member | Pass at 390px; create is absent and installed-rule controls are disabled | `rules-member.{png,aria.yml}` |
| Rules, loading | Pass at 390px under delayed requests; semantic header and card skeletons stay aligned | `rules-loading-390.png` |
| Responses, admin populated | Pass at 1280px and 390px; desktop builder/preview/redaction and mobile builder presentation remain reachable | `responses-admin-{1280,390}.{png,aria.yml}` |
| Responses, member | Pass at 390px with read-only response controls | `responses-member.{png,aria.yml}` |
| Responses, loading | Pass at 390px under delayed requests; header, outcome control, and builder skeleton remain stable | `responses-loading-390.png` |

No capture produced document overflow. The transient console errors seen during the first desktop response capture did not reproduce on an isolated rerun.

## Save-queue seam

The shared save queue now owns a JSON-value contract instead of open `unknown` dictionaries. Rules, responses, and workflows retain the same injected commit behavior. Browser verification queued a rule change and discarded it; the unsaved-change guard cleared and the original state returned. Unit coverage still verifies noop clearing, replacement, independent keys, structural equality, full success/failure, and partial failure.

## Verification

- Web typecheck passed.
- 35 focused save-queue, rules-parameter, and workflow permission tests passed.
- Admin/member rule permissions were browser-verified after the queue refactor.
- Changed-line lint passed against `3fbde42d`.
- Exact design-system baseline decreased to arbitrary values `64`, raw color `493`, spacing `652`, and typography `323`; other counts did not rise.
