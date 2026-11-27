# Tripwire — root agent rules

> `spec.md` is the source of truth. If code contradicts the spec, the spec wins
> until Grim amends it. Nothing in the cut list gets built. No exceptions "while
> we're in here." Verify each build step's *done when* with your own eyes before
> starting the next.

## Mission
Tripwire is a **contribution gatekeeper for git forges**. It ingests forge
webhooks, evaluates contributors and change requests against composable **rules**
orchestrated by **workflows**, produces auditable **runs**, and acts on the forge
(block, label, request GitHub review, human review). Core speaks only
git's universal layer plus an abstract signal vocabulary; platform packages
translate their social layer into it. MVP is GitHub, balls to the wall — the
seams for agnosticism exist from day 1, the second adapter does not.

## The dependency arrows (verbatim from §3 — enforced in CI)
```
contracts     ← everything            (imports nothing but zod)
utils         ← everything except contracts
forge         ← forge-github, forge-opengit, forge-gitcafe, worker
                                       (interface + types only; imports contracts)
core          ← worker ONLY           (pure: imports contracts + utils only.
                                       NO I/O, no db, no forge, no AI SDK, no octokit.
                                       Effects are INJECTED)
db            ← worker, api, web, mcp (schema + services)
auth          ← web, api, mcp         (./server sessions + posture guard,
                                       ./client browser; imports db + utils)
forge-github  ← worker, api           (api uses webhook verify only)
forge-gitcafe ← worker, api           (GitCafe protocol; activation remains gated)
ui            ← web                   (primitives; no app logic, no data fetching)
apps/cli      → contracts + @tripwire-sh/sdk
                                      (npm @tripwire-sh/cli, bin `tripwire`; one ESM
                                       file for Node. Talks to the MCP server over HTTP)
```
apps import packages; packages NEVER import apps; nothing imports core except
worker. `scripts/check-boundaries.ts` fails the build on any wrong-direction
import.

Apps: `apps/web` (dashboard + auth server), `apps/api` (webhooks + SSE),
`apps/worker` (runs), `apps/mcp` (remote MCP server for agents, a resource
server over `@tripwire/db` services), `apps/cli` (`npx @tripwire-sh/cli`, the
agent installer and device-grant login). `apps/mcp` and `apps/cli` approved
2026-10-22 (docs/research/agent-setup.md).

## Naming conventions (§9)
- Files **kebab-case** (`event-list.tsx`, `account-age.ts`) — including utils and
  core. Components PascalCase. Hooks `use-*`. Constants SCREAMING_SNAKE_CASE.
  Interfaces PascalCase with a suffix (`EventListProps`). Rule ids kebab-case
  with version: `account-age@1`. DB columns snake_case.
- Barrel `index.ts` at 3+ exports; never re-export from a non-barrel.
- Absolute imports always: `#/` inside `apps/web`, `@tripwire/*` across packages.
  Never relative `../../..`. `import type` for type-only imports.
- Import order: react/core → external → `@tripwire/ui` → `#/lib` → stores/queries
  → feature → CSS.

## Type safety (enforced)
- TypeScript **strict, ESM only**. No `any` — use `unknown` + guards.
- **Zod at every boundary.** Schemas that cross a boundary live in
  `@tripwire/contracts` and nowhere else (domain-internal validators may use Zod
  locally). Every jsonb column has a contracts schema **validated on write**.
- Types in code, JSON on the wire: rule results serialize as validated JSON; the
  typed registry is what the SDK sees later.

## Don't redefine — check first
Before writing ANY helper, check `@tripwire/utils`. Before writing ANY UI
primitive, check `@tripwire/ui`. A helper used by 2+ files moves to utils; a
primitive belongs in ui. Never redefine what already has a home.

## UI architecture and regression governance

These rules are mandatory whenever an agent touches `apps/web/**`,
`packages/ui/**`, a visual test, or the design system. Before editing, read the
root `DESIGN.md`, applicable scoped `agents.md`, `.claude/rules/frontend.md`,
`.claude/skills/tripwire-design/SKILL.md`, and the antislop files named below.

### Visual evidence is part of the implementation

Every change that can affect rendered UI must use
`.agents/skills/before-and-after/SKILL.md`. Capture the current surface before
the first edit and capture the result afterward at matching routes, viewports,
themes, data, and interaction states. Motion changes require a recording or
frame sequence. Net-new surfaces use an after-only preview. Preserve-only
refactors require a pair proving parity.

The screenshots or recordings must be published in the PR through the skill's
marked block and verified on the rendered PR. A UI task is not done, and its PR
must not be handed to the user, while that evidence is missing. Tests, DOM
inspection, and the independent visual audit supplement this evidence; they do
not replace it. Capture files stay out of the product commit unless the user
explicitly asks to version them.

### Compose the system in layers

Do not infer a design-system component from its root HTML element. A product
control may render a `<button>` without being the generic `Button` component.
Use these layers, in this order:

1. **Native semantics** — HTML element, keyboard behavior, form behavior, ARIA.
2. **Behavior primitive** — ui-sdk owns headless behavior such as dialog,
   popover, menu, tabs, selection, focus, and dismissal.
3. **Styled control** — `@tripwire/ui` owns application-agnostic Tripwire
   chrome and finite semantic props.
4. **Product pattern or molecule** — a named composition owns contextual
   anatomy and geometry. A proven application-agnostic molecule may live in
   `@tripwire/ui`; anything with product data, navigation, queries, auth, or
   domain logic stays in `apps/web/src/components`.
5. **Feature and route** — feature components bind data and behavior; thin
   routes bind the page component, pending component, and SEO.

Example: the sidebar account entry is a native `button` using a popover trigger
behavior, rendered by a named `SidebarAccountTrigger` molecule, which opens the
data-aware `AccountMenu`. It is not `Button variant="account-menu"`.

### Variants describe a shared contract, not a product location

A prop belongs on a shared control only when all usages retain the same
anatomy, behavior, interaction contract, and accessibility contract. Finite
semantic axes such as emphasis, intent, size, loading, disabled state, and icon
placement are valid. Product roles such as `account-menu`, `repo-picker`,
`search-launcher`, `sidebar-navigation`, and `workspace-switcher` are not Button
variants. Give them a named control or molecule. Parent layout differences stay
with the molecule or container. Keep a one-off local until real call sites prove
reuse; never create an enum to hide unrelated compositions behind one API.

### Preserve approved output unless a redesign is explicit

An existing approved Tripwire surface is the visual and interaction baseline.
Replacing a primitive does not authorize changing spacing, sizing, typography,
alignment, contrast, motion, focus behavior, or responsive behavior. Any such
change is a regression unless the work item explicitly marks that surface for
redesign and names its approved reference. External design systems are
architectural precedent for boundaries and APIs, not permission to copy their
appearance or override Tripwire's baseline.

Before a broad UI migration, primitive replacement, or repair pass begins,
write a user-approved implementation spec. It must enumerate:

- every in-scope surface and route;
- the reference or captured baseline for each surface;
- whether each surface is `preserve` or `redesign`;
- component ownership across the five layers above;
- required themes, breakpoints, content extremes, and interaction states;
- keyboard, focus, loading, empty, error, disabled, and reduced-motion states;
- migration order, test coverage, visual evidence, and per-surface done-when
  criteria.

Do not start the broad pass from a loose issue list. Fix one vertical slice,
verify every consumer, then move to the next primitive or molecule.

### Independent visual audit after every repair round

Each UI repair round ends with a fresh audit subagent that did not implement
that round. The audit is read-only: it may inspect code and operate the app, but
must not make fixes. It compares the rendered result to the approved reference
across the required themes, breakpoints, and states, then reports evidence and
a score. The implementing agent must not grade its own work.

Capture browser screenshots of every affected surface before editing and
again after verification. Keep the route, fixture data, viewport, theme, and
interaction state matched. Store both sets together and link them from the
round's ledger entry. For keyboard and motion changes, include intermediate
states or a recording. If a true pre-edit capture was missed, label any
reconstruction or reference comparison and disclose the gap.

Score 0–5 in each category, then multiply by the listed weight divided by 5:

- geometry, edges, alignment, and pixel placement — 20;
- spacing, density, and rhythm — 15;
- typography, icon sizing, and optical alignment — 15;
- color, contrast, and theme parity — 15;
- surface hierarchy, borders, elevation, and nested-card misuse — 15;
- interaction states, focus, overlays, and motion — 10;
- responsive behavior, overflow, and content resilience — 5;
- keyboard and accessibility behavior — 5.

Category meanings: `5` matches the reference or an explicitly approved change;
`4` has only minor polish defects; `3` has visible inconsistencies; `2` has a
systematic mismatch; `1` is substantially broken; `0` is missing or unusable.
A round passes only with no blocker, no category below 4, a total score of at
least 95, and user approval of any intentional visual delta.

Every finding must include the route and surface, viewport, theme, UI state,
expected reference, observed difference, measured pixel or token delta when
possible, severity, screenshot evidence, owning layer, and whether it is a
regression or an approved redesign. Specifically inspect shared edges, left and
right padding, baselines, icon optical centering, contrast equivalence between
themes and states, accidental nested cards, duplicated borders, incorrect
elevation, clipping, wrapping, scroll behavior, overlays, hover/active/focus
states, and reduced motion. A score without this evidence is invalid.

## useEffect policy (§9)
Keep `useEffect` usage down. If an effect syncs server data, it should be a
TanStack Query; if it derives state, it should be `useMemo`; use refs for stable
callback deps. Server state is never `useState` + `fetch`.

## Comments policy
**TSDoc only.** No `====` separator banners. No non-TSDoc narration comments.
Comment the *why*, not the *what*.

## Errors
Values in core, catch-log-retry at the edges. Expected outcomes are values, not
exceptions — a rule that can't evaluate returns `{ status: 'skipped', reason }`.
Throws are reserved for bugs. One flaky forge call degrades one rule's evidence,
never the whole run.

## Logging
**pino only.** Never `console.log`. Request IDs are threaded into worker jobs.

## IDs
`generateId()` from `@tripwire/utils` returns **UUIDv7** and is the only id
source. Never `crypto.randomUUID`, never nanoid, never a raw uuid lib — anywhere.

## CI prep (green from the first commit)
Biome + typecheck + `scripts/check-boundaries.ts` + `bun test` must all pass.
Tests are written **alongside** features, not after. Fixtures are captured real
payloads (scrubbed), never invented from docs.

## The old prod repo
Inspiration only — rule logic, GitHub API quirks, webhook lessons. **Never copy
files from it.** It contains the scope creep that killed v1.

## Do not add things
- NO new dependencies without a DECISIONS.md entry stating what it replaces and
  why the stack (§2 of the spec) can't do it. "Convenient" is not a reason.
- NO new top-level packages, apps, or folders. The §3 layout is closed. If work
  doesn't fit, stop and flag it — do not invent a home for it.
  Approved exception: `packages/forge-gitcafe` owns GitCafe code and fixtures
  (2026-10-27, DECISIONS.md); historical OpenGit remains in `forge-opengit`.
- NO abstractions for single consumers: no utils.ts used by one file, no base
  classes with one subclass, no "future-proofing" interfaces beyond ForgeAdapter.
- NO scaffolding beyond the current build step. Finishing early means raising
  quality, never widening scope.
- Scaffolding rules, routes, or fixtures happens through .claude/commands/ —
  never freehand. If a command doesn't exist for it, that's a signal to stop.
- Every generator command has a validator pair. Additions are audited by a
  different procedure than the one that created them.

## The cut list (append, never delete)
GitLab / any second forge adapter · ~~SDK publishing~~ (lifted 2026-11-05 for
the standalone `@tripwire-sh/sdk` TypeScript SDK only) · public OpenAPI surface ·
~~`apps/mcp` implementation~~ (lifted 2026-10-22) · ML layer · org-level features · billing ·
email/password auth · deep observability beyond pino · deployment automation ·
content classifiers (profanity / harassment / NSFW) ·
PR-description content matching · discussions / wiki / commit-message scanning ·
community report buttons · auto-delete (permanent) · cross-repo content bans ·
signal nodes in the workflow editor (trigger/rule/gate/action nodes already exist
— only SIGNAL nodes are deferred).
A helpful agent scaffolding `forge-gitlab` because the sibling slot visibly
exists is the same scope creep that killed v1, typing faster.

GitCafe integration is approved as an exception to the second-forge deferral
(2026-10-27, DECISIONS.md); other deferred forges remain out of scope.

Organization-level appeals and standalone moderation settings are approved as
exceptions to the org-level deferral (2026-11-10, DECISIONS.md); other org-level
features remain out of scope.

## Governance map
- Scoped `agents.md` files inject rules when a session touches their area.
- `.claude/rules/*.md` are the full path-scoped rule docs they point to.
- `.claude/commands/*.md` are the parameterized, repeatable procedures.
- `.claude/skills/tripwire-design/` distills the demo's aesthetic for UI work.
**Structure is documentation:** every deliberate deferral is encoded in a file.

## Commit Messages & Pull Requests

Commits use the conventional-commit shape: `fix: resolve auth token expiry`.
commitlint enforces it on the `commit-msg` hook (see `commitlint.config.ts`).
The hook is wired by `bun install`; `--no-verify` skips it.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.agents/skills/antislop/SKILL.md`
- Copy & text: `antislop-copywriting`: `.agents/skills/antislop-copywriting/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.agents/skills/antislop-layoutmobile/SKILL.md`
- People: `antislop-human`: `.agents/skills/antislop-human/SKILL.md`
- Code comments: `antislop-code`: `.agents/skills/antislop-code/SKILL.md`
- UI / visual: `antislop-ui`: `.agents/skills/antislop-ui/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->

<!-- visual-evidence:start -->
## UI visual evidence
For every task that edits rendered UI, read
`.agents/skills/before-and-after/SKILL.md` before the first edit. This includes
layout, styles, tokens, components, visible copy, responsive behavior, motion,
states, and preserve-only UI refactors.

Before editing, say `visual evidence active: before/after required for every
changed UI surface.` once. Capture the existing surface before editing, then
capture the matching result after editing. Use an after-only Preview for a
net-new surface and a recording or frame sequence for motion. Do not hand off a
UI change or its PR until the marked evidence block is published and verified
on the rendered PR. If a draft PR is needed to obtain a preview deployment,
create it without handing it off, attach the evidence, verify it, then report
the PR. Tests and written descriptions never replace the media.
<!-- visual-evidence:end -->
