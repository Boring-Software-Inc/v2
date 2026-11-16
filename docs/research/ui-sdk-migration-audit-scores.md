# UI SDK migration audit scores

This register gathers independent audit scores for the final migration review.
Read each score with its scope. A 100 for a control cannot offset a failed
route, and the composition audit uses a separate rubric. Retain earlier scores
when a re-audit supersedes them so the final review can show what improved.

Sources: the local migration ledger, the
[public component catalog](../../packages/ui/COMPONENTS.md), and independent
agent reports in the migration thread. Unscored checks and automated pass
counts do not appear as audit scores.

| Scope | Recorded score(s) | Scope or remaining gap |
| --- | --- | --- |
| Sidebar motion and authenticated shell | 97/100 | Corrected motion and shell rechecks reported 97; the executable overshoot check was added afterward. |
| Popover | 96/100 | Re-audit; the pinned SDK's edge flipping leaves exact placement parity open. |
| Slider / StepSlider | 93 → 100/100 | Follow-up closed agent value registration and rendered sweep gaps. |
| Tooltip | 100/100 | Includes the collapsed rail's immediate animation and 8px gap. |
| Tabs | 100/100 | Includes controlled selection and reduced motion. |
| Drawer / Sheet | 100/100 | Modal behavior; Add block composition was audited separately. |
| Add block palette | 97 → 100/100 | Visual parity pass, then the follow-up composition pass. |
| Skeleton / Table | 100/100 | API cleanup only; remaining visual parity is open. |
| Alert and destructive confirmation | 100/100 | Confirmation behavior and Glaze visuals. |
| Command / CommandDialog | 100/100 | Includes destructive agent confirmation. |
| NumberInput | 100/100 | Includes form/agent behavior and rendered geometry. |
| Dialog family | 100/100 | Shared contract; product callsites still require verification. |
| Button / IconButton / ActionLink | 100/100 | Includes native form and link semantics. |
| Checkbox / CheckboxGroup / Switch | 100/100 | Includes validity, read-only, reset, and agent behavior. |
| Field / Input / Textarea | 100/100 | Includes shared shape, naming, and focus. |
| Collapsible / Accordion | 100/100 | Includes find-in-page and reduced motion. |
| Combobox | 100/100 | Includes filtering, forms, and controlled/agent interactions. |
| Menu | 100/100 | Includes destructive confirmation and dismissal. |
| RadioGroup / SegmentedControl | 100/100 | Shared fixture; does not close Activity's mobile filter composition. |
| Select | 100/100 | Includes native and popup contracts. |
| RelativeTime | 100/100 | Focused recheck of valid and invalid timestamp semantics. |
| Badge / Icon | 100/100 | Focused visual, state, and accessibility audit. |
| Codebase composition | 80/100 | Separate rubric: primitives 22/25, product components 17/20, routes 17/20, adoption 15/20, enforcement 9/15. Re-run against the final tree. |
| Codebase composition follow-up | 86/100 | Same rubric: primitives 23/25, product components 17/20, routes 17/20, adoption 16/20, enforcement 13/15. Open findings: surface styling escapes, generic Chip, oversized OAuth route, incomplete agent-action coverage, and no full route matrix in CI. The auditor implemented scoped Settings repairs and scored architecture only. |
| Codebase composition after route and Chip corrections | 90/100 | Primitives 23/25, product components 18/20, routes 19/20, adoption 17/20, enforcement 13/15. Direct visual imports from route modules are zero and guarded by CI; chips now have finite contracts, and the browser agent has scoped Combobox visibility. Card and Item surfaces, remaining legacy styles and complete route evidence remain open. |
| Codebase composition after surface and lint corrections | 93/100 | Primitives 24/25, product components 19/20, routes 19/20, adoption 17/20, enforcement 14/15. Card, Panel and Item styling is scoped by types; projected PR changed-line lint passed for 404 files. Native styling props remain on other surfaces and the full route matrix remains outside CI. |
| Roles / Connections / Activity route cohesion | 75/100 | Provisional. Geometry 16/20, spacing 9/15, typography 9/15, theme 15/15, surfaces 12/15, interaction 8/10, responsive 2/5, accessibility 4/5. Mobile blockers and baseline gaps prevent closeout. |
| Roles / Connections / Activity mobile repair re-audit | 98/100 | Targeted repair only. Geometry 20/20, spacing 15/15, typography 15/15, theme 15/15, surfaces 15/15, interaction 8/10, responsive 5/5, accessibility 5/5. All three blockers resolved; independent interaction evidence was narrower than the full route contract. Settled Roles comparison was captured after the review. |
| Settings headings and timezone repair | 96/100 | Targeted audit: geometry 16/20; all other categories full. No blocker in the repair; the 1280px dark Billing capture was scrolled and could not certify top-of-page geometry. Full Settings parity remains open. |
| Settings disclosure, destructive controls, Billing and Account | 97/100 | Targeted re-audit. Spacing 12/15; all other categories full. A settled Redaction panel contains all five controls (earlier frames were captured mid-opening). Minor Account row spacing remains; this does not certify full Settings parity. |
| Public auth edges and Appeals | 84/100 | Geometry 16/20, spacing 15/15, type/icons 12/15, theme 9/15, surfaces 12/15, interaction 10/10, responsive 5/5, access 5/5. Found lost primary treatment on Appeals and Invite, a squeezed Appeals avatar, and residual public shell differences. Confirmed signed-in 404 has an accessible home link. See the follow-up below. |
| Public CTA and Appeals avatar follow-up | 87/100 | Geometry 16/20, spacing 15/15, type/icons 12/15, theme 12/15, surfaces 12/15, interaction 10/10, responsive 5/5, access 5/5. Primary treatment and painted 32px avatar restored. Control widths and field/card hierarchy still differ from Glaze. |
| Workflow grid, editor and push review | 82/100 | Geometry 16/20, spacing 12/15, type/icons 12/15, theme 12/15, surfaces 12/15, interaction 8/10, responsive 5/5, access 5/5. Forty-eight paired browser cases passed. More controls, Copy/Accept, Toolbox search treatment and Code surface differed; see workflow-run-route-verification. |
| Workflow Grid card follow-up | 85/100 | Geometry 16/20, spacing 15/15, type/icons 12/15, theme 9/15, surfaces 15/15, interaction 8/10, responsive 5/5, access 5/5. The 390px and 1280px card sample in both themes retains the larger coarse-pointer target. This score predates the follow-up that matched the status glyph and checked thumb; switch track width and gradient still differ. Evidence: workflow-grid-final-independent and grid-status-switch. |
| Item contract re-audit | 97/100 | Geometry 20/20, spacing 15/15, type/icons 15/15, theme 15/15, surfaces 12/15, interaction 10/10, responsive 5/5, access 5/5. Account screenshots decode to identical pixels, and Add Headline keyboard activation passed. A concurrent Activity date trigger regression limited the surface score; fixed separately. |
| Rules Installed follow-up | 87/100 | Geometry 16/20, spacing 12/15, type/icons 12/15, theme 12/15, surfaces 15/15, interaction 10/10, responsive 5/5, access 5/5. First card geometry now matches at 390px and 1280px in both themes; keyboard selects Library and Custom with focus intact. This score predates the follow-up that matched sparkline width and color. Segment width, description position and search shortcut remain. Evidence: rules-composition-after and rules-sparkline-final. |
| Rules Installed and Library spacing | 83 → 90/100 | Geometry 16/20, spacing 12/15, type/icons 12/15, theme 15/15, surfaces 15/15, interaction 10/10, responsive 5/5, access 5/5 after the repair. Installed card anatomy and Library action widths match. Long-title truncation was repaired afterward. Evidence: rules-final-spacing and rules-library-title-ellipsis. |
| Workflow Grid action controls | 93/100 | Geometry 16/20, spacing 12/15 with all other categories full. Measured 28×16px track, checked thumb and gradient match Glaze. The neighboring 44px touch control moves the switch 18px left on mobile; status alignment still differs. Evidence: workflow-grid-switch-independent. |
| Public vessel and CTA re-audit | 83/100 | Geometry 16/20, spacing 12/15, type/icons 12/15, theme 12/15, surfaces 12/15, interaction 10/10, responsive 4/5, access 5/5. Primary actions and desktop field/card sizes match. Mobile inbox, dark surface, avatar shape and FAQ/Dev disclosure treatment still differ. Evidence: public-vessel-cta-round. |
| Workflow Grid Create control | 85/100 | Geometry 16/20, spacing 12/15, type/icons 12/15, theme 15/15, surfaces 12/15, interaction 8/10, responsive 5/5, access 5/5. Closed control dimensions and keyboard match. Shared seam and popup anchor differ; mobile popup starts at x8 vs x25, and is 22px taller. Visual search shortcut remains absent. Evidence: workflow-grid-create-control. |
| Replay Show all focus handoff | 100/100 | Targeted audit of the keyboard focus change. Enter verified in both themes at 390px and 1280px. Space verified at 1280px dark; pointer verified in three combinations. After expansion the sixth row receives a visible outline. Broader replay parity stays open. Evidence in replay-show-all-focus and the independent Chromium captures. |
| Workflow Grid Create control follow-up | 84/100 | Joined seam, whole-group anchor, up caret, keyboard navigation and Escape focus return verified in an eight-case comparison. Popup density, placement, label typography and focus fill still differ from Glaze. Evidence in workflow-grid-independent-followup. |
| Workflow Grid and Rules filter controls | 90/100 | Slash hint matches 16px dimensions and 11px end inset. All 24 independent browser cases passed slash focus, typing and Escape. Field widths, start inset and text weight still differ. Evidence in filter-bar-search-shortcut-independent. |
| Workflow Grid Templates menu after compact and placement repair | 92 → 100/100 | Independent Chromium comparison passed 22 cases, including the 480px wrapping boundary. Menu height, row density, typography, focus wash, caret and open placement match. Keyboard navigation and Escape focus return confirmed. Workflow creation and full-route parity remain open. Evidence in workflow-menu-alignment-independent. |
| Workflow Grid and Rules filter search follow-up | 96/100 | Independent 24-case comparison. The 29px text inset, 500 weight, 26px field height, fine-pointer shortcut and coarse-pointer sizing match. Neighboring controls still give the desktop search 4px more on Workflow Grid and 2px more on Rules. Evidence in filter-search-polish-independent. |
| Workflow Grid and Rules closed filter rows | 100/100 | Independent 24-case browser comparison matched desktop and narrow Glaze widths exactly. Slash focus, typing, Escape, and Analytics overflow checks passed. Evidence in filter-row-width-parity-independent. |
| Filter menu dismissal | 100/100 | Independent keyboard comparison passed 16 paired Grid and Rules cases, plus desktop pointer selection. Single choices dismiss and return focus. Analytics Contributor stays open when checked and Escape returns focus. Evidence in filter-row-width-parity. |
| Admin Users pagination and Access toolbar | 93/100 | Geometry 16/20, spacing 12/15, all other categories full. Eight paired keyboard cases passed. Toolbar heights match and footer position is within 0.5px. The Access group is about 26px narrower at 390px and 14px narrower at 1280px. The desktop search is about 12px wider. Evidence in admin-pagination-parity and admin-pagination-access-measured-independent. |
| Admin Users toolbar and selection alignment follow-up | 96/100 | All eight paired keyboard and pagination cases passed. Toolbar geometry and borders, the 40px selection column, 16px checkboxes, and 20px avatars match Glaze. The User column is 1.92px wider at 390px and 3.41px wider at 1280px. Table height differs by 0.5px. Evidence in admin-access-final-recheck. |
| Analytics Metric selector | 100/100 | Eight paired cases matched Glaze sizing, position, option geometry, and colors. ArrowRight selected Blocked and kept focus. Activity and Responses geometry smoke checks passed. Evidence in metric-mascot and the independent browser audit. |
| Mascot Resting face visual repair | 96/100 | Eight paired renders matched the selector and enclosing card locally. The mobile control still sits 21.81px higher due to content above it. Happy activation remained unverified on both builds. Evidence in mascot-resting-face-final-independent. |
| Codebase composition, independent closeout audit | 92/100 | Primitive contracts 23/25, product components 19/20, routes 19/20, adoption 17/20, enforcement 14/15. Seven styled families still accept styling overrides. All 56 route modules were reviewed in source, with zero direct visual UI imports. |
| App-wide visual cohesion | Unscored | Authenticated fixture requests and WSL intermittently timed out on both builds. The completed scope surfaced visual differences in Login, public Appeals, Runs and Game. Route inventory is complete; full browser, permission and write-path parity is open. |

| Signed-in fixture rerun and Notra Settings composition | 92/100 source composition | 56 route modules inventoried. The paired fixture completed all 62 intended HTTP pairs and restored signed-in browser renders. The audit does not close the full interaction matrix. |
| Public Login, Runs, Game, and Appeals repair | 90/90 measured visual, responsive, and accessibility points | Four repaired targets matched across 14 fresh pairs. Two mobile light baseline captures came from the prior audit. Keyboard focus passed in six browser cases. Interaction accounts for the ten unscored points. |
| Notra-inspired Settings General, Members, and Pending | 96/100 | 24 settled browser pairs across four widths and both themes with zero page overflow. The table header moves with the filter controls and the table scroller has no accessible name. Keyboard access to actions, Pending filtering, and General delete confirmation focus were verified without submitting writes. |
| App-wide cohesion after fixture repair | Unscored | The retry reached 50 usable browser route and viewport states across 28 labels. A subsequent pass settled the four outstanding desktop pairs and added a matched mobile Workflow Review diff. The full interaction and write matrix and unapproved visual differences remain open. |

| Settings filter alignment and named scroll region | 100/100 scoped | Exact header alignment at 390px light and 1280px dark. Named regions accepted keyboard focus and scrolling. Pending filters and empty-state headers remained available. |
| Moderation settled desktop visual audit | 61/80 measured | At 1280px dark, 13 matching queue entries exposed missing separators, lost ID spacing, a neutral Block icon, narrow action buttons, and a 3px row stride increase. Responsive and interaction categories were outside the score. |

| Admin dashboard divider repair | 97/100 | Four widths in both themes. Row positions and dividers match. Surviving detail: labels measure 1–3px narrower. |
| Moderation queue and dialog repair | 96/100 | Queue and confirmation align, and keyboard focus returns correctly. Appeal portal is 5.12px narrower, and mobile Appeals is about 4px taller without overlap. |
| Workflow Editor chrome repair | 96/100 | Restored disclosure headers, control labels and dimensions. Small toolbar offsets and the resting canvas y position differ. |
| Workflow Review chrome repair | 98/100 | Restored selected control, sizing and wrapping. The complete keyboard focus ring is now inset and thicker than Glaze. |

| Notra Account action panels | 97/100 | Eight Chromium renders at four widths in both themes. Both dismissal paths restored focus, and no write was attempted. The Delete account launch button is neutral, with destructive treatment on the final confirmation. Evidence in account-actions-notra-independent. |

| Account deletion launcher follow-up | 100/100 scoped | Sign out card removed, destructive launcher opens the existing wizard, and Escape restores focus. Eight Chromium renders at four widths in both themes. No mutation attempts from opening or dismissing the wizard. Evidence in account-actions-followup-audit. |

| Workflow Review terminal notices | 100/100 scoped | Accepted, Declined, and Expired matched Glaze geometry, fill, icons, and copy in 12 settled pairs at 390px and 1280px in both themes. One reference capture came from the earlier audit on the same fixture. Keyboard navigation verified for the accepted outcome link. |

| Codebase composition, frozen final audit | 92/100 | Primitive contracts 23/25, product components 19/20, routes 19/20, adoption 17/20, enforcement 14/15. Reviewed all 56 route modules. Seven styled primitive families still accept styling overrides. |
| App-wide cohesion, frozen final audit | 76/100 | Geometry 16/20, spacing 9/15, typography and icons 12/15, color and contrast 9/15, hierarchy 12/15, interaction and motion 8/10, responsive 5/5, keyboard and accessibility 5/5. Below the 95-point threshold. The score covers inspected states, including 504 paired route and viewport cases. Some captures were loading states. The largest deductions were in private Runs, Settings actions, the Admin pilot form, and the dark 404. |

| Sidebar setup progress card | 100/100 scoped | Independent Chromium audit of the 3-of-4 fixture. Desktop light and dark align with Settings. Dismissal restores focus and persists through reload. Tested rail heights from 560px to 820px, collapsed rail, mobile popover, and the Moderation and Settings routes. Before and after captures are in sidebar-setup-progress. |

| Activity inset sections and setup timeline | 98 → 100/100 scoped | Six independent Chromium cases from 320px to 1313px. Verified separate internal and external link targets, short rail scrolling, mobile setup popover, and persistent keyboard dismissal. Follow-up corrected the first and last run row focus corners. Evidence in activity-inset-setup-timeline. |

| Private run details spacing | 96/100 scoped | Rules height, evidence control geometry, and verdict position match Glaze in 16 paired states at 390px and 1280px in both themes. Keyboard disclosure and Markdown clipboard checks passed. The desktop Copy control sits 3.23px farther right and is 0.45px narrower. Evidence in private-run-details-spacing. |

| Private run branch disclosures and timestamps | 96/100 scoped | Independent Chromium audit in light and dark at 390px and 1324px. Verified keyboard disclosures, successor navigation, and complete local and UTC hints. The longer shared date wraps to a second metadata line, growing the header metadata by 16px. Evidence in private-run-disclosures. |

| Account theme preview transition | 98/100 scoped | Eight independent Chromium cases verified the exact preview bounds and radius, 300ms ease-in-out, keyboard focus, and viewport coverage at 390px and 1324px. OS and account reduced motion and the no-API fallback applied the theme immediately. The native root snapshot pauses pointer hit testing during the reveal. Evidence in theme-card-reveal. |

| Command palette spacing and focus | 100/100 scoped | The independent browser audit measured a 143px single-result dialog and a 123px empty dialog, down from 432px. Verified short-viewport scrolling, coarse pointer, focus restoration, query reset, and the destructive confirmation. Evidence in pilot-form-command-palette. |
| Admin Pilot form | 97/100 scoped | The independent audit matched field edges in both themes at 390px and 1280px. Publish held 121.91px while queueing. Shared field typography differs slightly from Glaze. Chromium intercepted valid submissions to exercise the response states. Evidence in pilot-form-command-palette. |

| 404 recovery panel | 97/100 scoped | Chromium verified HTTP 404, exact Glaze panel geometry and fill at 390px and 1280px in both themes, working keyboard recovery, and the ghost with the runner disabled. Title and action text widths differ slightly. Matched evidence and independent report in not-found-repo-header. |
| Connected repo header link | 100/100 scoped | All four resting captures matched the before files. The title, metadata, timestamp, and padding open the repo, and the footer shortcuts remain separate. Keyboard focus covers the full linked header. Matched evidence and independent report in not-found-repo-header. |

The final review should report the latest independent score and evidence for
each in-scope round, unresolved findings, a fresh composition score, and the
app-wide cohesion score from the [repair spec](ui-sdk-migration-repair-spec.md).
Leave unscored areas explicit. The final cohesion score is an independent
audit of the final tree, not an average of the rows above.
