# Tripwire — root agent rules

> `spec.md` is the source of truth. If code contradicts the spec, the spec wins
> until Grim amends it. Nothing in the cut list gets built. No exceptions "while
> we're in here." Verify each build step's *done when* with your own eyes before
> starting the next.

## Mission
Tripwire is a **contribution gatekeeper for git forges**. It ingests forge
webhooks, evaluates contributors and change requests against composable **rules**
orchestrated by **workflows**, produces auditable **runs**, and acts on the forge
(block, label, comment, request review, send to moderation). Core speaks only
git's universal layer plus an abstract signal vocabulary; platform packages
translate their social layer into it. MVP is GitHub, balls to the wall — the
seams for agnosticism exist from day 1, the second adapter does not.

## The dependency arrows (verbatim from §3 — enforced in CI)
```
contracts     ← everything            (imports nothing but zod)
utils         ← everything except contracts
forge         ← forge-github, worker  (interface + types only; imports contracts)
core          ← worker ONLY           (pure: imports contracts + utils only.
                                       NO I/O, no db, no forge, no AI SDK, no octokit.
                                       Effects are INJECTED)
db            ← worker, api, web      (schema + services)
auth          ← web, api              (./server sessions + posture guard,
                                       ./client browser; imports db + utils)
forge-github  ← worker, api           (api uses webhook verify only)
ui            ← web                   (primitives; no app logic, no data fetching)
```
apps import packages; packages NEVER import apps; nothing imports core except
worker. `scripts/check-boundaries.ts` fails the build on any wrong-direction
import.

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
- NO abstractions for single consumers: no utils.ts used by one file, no base
  classes with one subclass, no "future-proofing" interfaces beyond ForgeAdapter.
- NO scaffolding beyond the current build step. Finishing early means raising
  quality, never widening scope.
- Scaffolding rules, routes, or fixtures happens through .claude/commands/ —
  never freehand. If a command doesn't exist for it, that's a signal to stop.
- Every generator command has a validator pair. Additions are audited by a
  different procedure than the one that created them.

## The cut list (append, never delete)
GitLab / any second forge adapter · SDK publishing · public OpenAPI surface ·
`apps/mcp` implementation · ML layer · org-level features · billing ·
email/password auth · deep observability beyond pino · deployment automation ·
content classifiers (profanity / harassment / NSFW) · `lock-thread` escalation ·
PR-description content matching · discussions / wiki / commit-message scanning ·
community report buttons · auto-delete (permanent) · cross-repo content bans ·
signal nodes in the workflow editor (trigger/rule/gate/action nodes already exist
— only SIGNAL nodes are deferred).
A helpful agent scaffolding `forge-gitlab` because the sibling slot visibly
exists is the same scope creep that killed v1, typing faster.

## Governance map
- Scoped `agents.md` files inject rules when a session touches their area.
- `.claude/rules/*.md` are the full path-scoped rule docs they point to.
- `.claude/commands/*.md` are the parameterized, repeatable procedures.
- `.claude/skills/tripwire-design/` distills the demo's aesthetic for UI work.
**Structure is documentation:** every deliberate deferral is encoded in a file.
