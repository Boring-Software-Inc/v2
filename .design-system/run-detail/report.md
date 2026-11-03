# Run detail surface

The run detail route now uses the accepted Focus task-page measure for both public and authenticated views. The semantic page header owns the run title, status metadata, and available actions; the evidence chain follows as the only primary task region.

## Contract changes

- `PageHeader` gained a closed `metadata` slot for status, timestamps, and other non-action page facts. It does not expose geometry or visual controls.
- Public and not-found shells use app-owned semantic layout roles instead of page-local color, spacing, and typography utilities.
- The pending route skeleton uses the same task-page width and header/body hierarchy as loaded runs.
- Run event titles and detail text now wrap hostile unbroken and Unicode content instead of widening the document.
- The not-found state now has a semantic level-one page title.

## Browser matrix

| State | Result | Evidence |
| --- | --- | --- |
| Public passing run | Pass at 1280px and 390px; public evidence and forge action remain available | `public-pass-{1280,390}.{png,aria.yml}` |
| Public blocked run | Pass at 1280px; failed rule evidence and forge actions remain readable | `public-block-1280.{png,aria.yml}` |
| Public paused/review run | Pass at 390px | `public-paused-390.{png,aria.yml}` |
| Authenticated full run | Pass at 1280px and 390px; full dashboard shell and `Re-run rules` action remain available | `private-admin-{1280,390}.{png,aria.yml}` |
| Missing or denied run | Pass at 390px with an indistinguishable `Run not found` state and level-one heading | `not-found-390.{png,aria.yml}` |
| Hostile event title | Pass at 320px with 100 unbroken characters plus Unicode, emoji, and RTL text; document width remained 320px | `hostile-title-320.png` |

The private/public access policy is additionally covered by integration tests: members receive the full view, signed-out private access returns nothing, public evidence excludes private trace/configuration, and same-name repositories on another forge cannot leak access.

## Verification

- `@tripwire/ui` and web typechecks passed.
- 67 focused semantic-layout, run-chain, AI-trace, access-policy, collapse, and database integration tests passed.
- Dependency boundaries passed.
- Browser captures produced no document overflow after the hostile-title fix.
- The run family scan decreased from raw color `60` to `52`, spacing `73` to `58`, and typography `42` to `38` without adding anti-slop findings.
- The exact repository baseline decreased to raw color `485`, spacing `637`, and typography `319`; other counts did not rise.
