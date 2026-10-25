# Decisions

Append-only. Every new dependency needs an entry here stating what it replaces
and why the stack (§2) can't do it — see `AGENTS.md`.

## 2026-07-28 — commitlint on the `commit-msg` hook

**Added:** `@commitlint/cli`, `@commitlint/config-conventional`,
`@commitlint/types` (root devDependencies).

**What it replaces:** nothing automated — the convention in `CLAUDE.md`
("include the task ID", conventional-commit shape) was documented but unenforced,
and `git log` shows the drift: `Update styles.css`, `bye bye dither button`,
`Update dashboard-layout.tsx`. Task IDs are how Median auto-transitions tasks, so
a malformed subject silently drops a task on the floor.

**Why the stack can't do it:** Biome lints source, not commit messages. Bun has
no commit-message hook. This is the only gate that runs before a commit object
exists.

**No husky.** The hook is a plain script at `scripts/githooks/commit-msg`, wired
by `git config core.hooksPath scripts/githooks` from the root `prepare` script,
so `bun install` sets it up for everyone. That avoids a fourth dependency and a
new top-level directory (§3 layout stays closed).

**Deviations from stock `config-conventional`**, both forced by existing practice:

1. `headerPattern` accepts an optional `ABC-123 ` prefix before the type, because
   this repo writes `TRP-83 feat(economics): …`. The stock parser reads that
   prefix as the type and rejects every such commit. The ticket is **optional** —
   `chore: bump deps` is legitimate. Set `REQUIRE_TICKET = true` in
   `commitlint.config.ts` to make it mandatory (both states are tested).
2. `design` joins the type enum; it is in active use on UI branches.

**Escape hatch:** `git commit --no-verify`.

## 2026-10-22 — agent setup: oauth provider, cimd, mcp sdk, api keys

Design: `docs/research/agent-setup.md`, approved by the founder 2026-10-22.

**Upgraded:** `better-auth` and `@better-auth/infra` to the 1.7 line
(`better-auth@1.7.12`, `@better-auth/infra@0.4.22`). The device grant for OAuth
clients and CIMD only exist in 1.7. Two API changes came with it: generic OAuth
providers sign in through `signIn.social` / `linkSocial` (callback path
`/callback/<id>`), and `unlinkAccount` takes the account row id.

**Added:** `@better-auth/oauth-provider` (packages/auth).
- Replaces: nothing. Tripwire had no way to issue tokens to an agent or CLI.
- Why the stack can't: better-auth sessions are browser cookies with full
  access. The MCP spec needs an OAuth 2.1 authorization server with PKCE,
  RFC 8707 audience-bound tokens, RFC 9728 discovery and rotating refresh
  tokens. Its `oauthDeviceAuthorization` gives the CLI the device grant; the
  standalone `device-authorization` plugin is not used because it returns a
  full session token.

**Added:** `@better-auth/cimd` (packages/auth).
- Replaces: dynamic client registration as the main client identity path.
- Why: the MCP 2026-07-28 spec makes client ID metadata documents the SHOULD
  and deprecates DCR. DCR stays on as the fallback for older clients.

**Added:** `@modelcontextprotocol/sdk` (apps/mcp).
- Replaces: nothing. `apps/mcp` is the new remote MCP head.
- Why: the official SDK implements the MCP protocol and the streamable HTTP
  transport. Hand-rolling JSON-RPC, capability negotiation and the transport is
  the kind of protocol code we should not own.

**Approved, not yet installed:** `@better-auth/api-key`.
- For: org-owned CI keys with an expiry (90 days default) and narrow
  permissions, sent through an env var.
- Lands with the CLI token commands. Nothing in this change needs it.

**New app:** `apps/mcp` (lifted off the cut list) and `apps/cli` (built
separately). See AGENTS.md.

**Lifetimes:** access token 15 minutes, refresh token 30 days absolute from
when the user connected the agent (enforced through `agent_grants`), device
code 10 minutes.

## 2026-10-22: `apps/cli`, the `tripwire` installer and terminal client

**Added:** a new app, `apps/cli`, published as `@tripwire-sh/cli` with the bin
`tripwire`. Approved by Grim for the agent setup work. Its devDependencies:
`@modelcontextprotocol/sdk`, `@clack/prompts`, `commander` (v14), `picocolors`,
`zod`. Bun bundles them into one ESM file (`dist/tripwire.js`), so the
published package has no runtime dependencies and runs under `npx` on Node 20.12+.

**What it replaces:** nothing. Today setup is only the web onboarding. The CLI
copies Sentry's `npx @sentry/agent-plugin install` flow, but with no plugins:
it adds the remote MCP server and the `tripwire-get-started` skill to each
agent directly.

**Why the stack can't do it:**

- `@modelcontextprotocol/sdk`: the management commands are an MCP client of
  the same server the agents use. Writing the streamable HTTP transport and
  JSON-RPC session by hand would be a second, untested MCP client.
- `@clack/prompts`: the agent multi-select and the confirm prompt need a raw
  mode TTY prompt. Already a root devDependency for `scripts/e2e`.
- `commander`: subcommands, `--help` and option parsing for 11 commands.
  Already a root devDependency. Pinned to v14 because v15 needs Node 22.12.
- `picocolors`: color that respects `NO_COLOR`. Already a root devDependency.
- `zod`: parses every external value (agent config files, OAuth responses,
  stored credentials, tool output). Already used by `@tripwire/contracts`.

**Boundaries:** `apps/cli` may import `@tripwire/contracts` only, so it can
share the setup prompt builder with the web app later.

**Added later:** `jsonc-parser` and `yaml` (devDependencies, bundled).
- Replaces: rewriting agent configs with `JSON.stringify`, which drops
  comments and fails on the JSONC that Zed, OpenCode, Kilo and Amp keep.
- Why the stack can't: Goose keeps its MCP servers in YAML, and nothing in the
  repo edits YAML or JSONC in place. Both were already in `bun.lock` through
  other tools.

## 2026-10-24: `@pierre/diffs` for code and diffs in the web app

**Added:** `@pierre/diffs@^1.6.1` (apps/web). Apache-2.0. It pulls `shiki`
(MIT), `diff` (BSD-3-Clause), `@pierre/theme`, `@pierre/theming` and
`@pierre/highlights` (all Apache-2.0).

**What it replaces:** the Glaze `tokenize` + `TokenLine` rendering in the
workflow Code view, and the plain "Unsaved" badge. The founder asked for
Pierre on the Code view. The push review page needs the same diff surface.

**Why the stack can't do it:** Glaze's tokenizer is small on purpose. It has
no diff, no split view, no word-level change marks, no hunk folding and no
line selection. Writing a diff renderer with those is a library's worth of
code we should not own.

**Alternatives looked at:**
- `react-diff-viewer-continued`: a diff only, no file view, styled with
  emotion, no Shiki.
- `@git-diff-view/react`: diff only, needs its own highlighter wiring.
- Shiki plus `diff` by hand: the same two deps Pierre already wraps, with
  the layout, selection and virtualization left to us.

**Size:** 11 MB unpacked on npm, most of it Shiki grammars that load on
demand. Nothing ships in the route chunk: `components/code` loads Pierre with
`React.lazy` after mount, so the server and the first paint render plain
text. Measured with `vite build` on the workflow editor route:
- route chunk `_org._repo.workflows._workflowId`: 305.22 kB (100.83 kB gzip)
  before, 308.10 kB (101.77 kB gzip) after.
- entry chunk: 1,849.68 kB before, 1,855.25 kB after.
- lazy `pierre-code` chunk: 404.51 kB (108.89 kB gzip), plus the TypeScript
  grammar, 181.08 kB (16.04 kB gzip), fetched only when code shows.

**Theme:** Pierre's own `pierre-light` and `pierre-dark` themes, full syntax
colour, picked from the app's light or dark setting (founder decision,
2026-10-24). Only the background is ours (`--code-surface`), so the code sits
in the Glaze card. Additions and deletions keep Pierre's green and red.

**Shared surface:** `apps/web/src/components/code` exports
`TripwireCodeFile` and `TripwireCodeDiff`. Use these, not `@pierre/diffs`
directly, so the theme and the lazy split stay in one place.

## 2026-10-24: CLI pushes wait for a person; apply_workflow stays direct

**Decision:** `tripwire workflows push` sends compiled workflows as a push
proposal (`workflow_push_proposals`, migration 0034). A member with
`workflows:manage` opens the review page, sees each workflow as a diff of
pulled `tripwire.ts` code, and accepts or declines. `--force` keeps the
direct save. The MCP tool `apply_workflow` stays direct for agents; agents
that want a person in the loop call `propose_workflow_push`.

**Why apply_workflow stays direct:** an agent calling `apply_workflow` already
holds a token its user granted `tripwire:configure` with `workflows:manage`.
That grant is the consent. A forced review would break every agent setup
flow that saves a workflow and turns it on in one session, and a new
workflow still starts off, so nothing runs until someone enables it.

**What blocks Accept:** the same refusals `apply_workflow` makes. Errors on a
workflow that is on, and a name another workflow holds. A workflow that is
off saves with errors, as a draft, because a push strips delivery secrets
and a new webhook step can only get its URL in the editor.

**Stale:** each proposal keeps, per workflow, the saved row id, a SHA-256 of
its stored definition and a redacted copy for the diff. Accept locks the
rows and refuses when any hash moved. Secrets are never stored in a
proposal; Accept merges them from the saved row, as apply does.

**Copy:** the UI says Decline, not Reject, per the constitution. The status
value stays `rejected`.

## 2026-10-24: workflow keys in tripwire.ts are slugs; ids live in the link

**Decision (founder, 2026-10-24):** a workflow's key in `tripwire.ts` is its
name as a slug (`"block-crypto-pushes": blockCryptoPushes()`), not its id.

- `workflowSlug` and `workflowKeys` in `@tripwire/contracts` make the key:
  lowercase ASCII words joined by `-`, at most 48 characters, `-2`, `-3` for a
  repeated name, in file order. The CLI, `get_workflow`, the Code view and the
  push review all use them, so they show the same key for the same name.
- The key to id map lives in `.tripwire/project.json` under `workflows`. Pull
  writes it. An accepted push or a `--force` push updates it. A pull keeps a
  key from the map, so a rename never makes a second key or a second workflow.
- `matchWorkflowIds` turns keys back into ids, in this order: the map, a key
  that is already a server id, the server workflow whose name has that slug,
  else a new workflow whose id is the key. The CLI says when it matched by name
  or will add a new one. The MCP tools `validate_workflow`, `apply_workflow`
  and `propose_workflow_push` run the same match, so an agent that sends keys
  without the map still lands on the right rows.
- The web shows the key from the saved name. After a rename that is not yet
  saved, the review and the Code view keep the old key, so the diff shows only
  the name change.

**Alternatives looked at:** ids as keys (what shipped first; unreadable
UUIDs), keys as the stored definition id (a rename or a slug change would
make a new workflow on the server), a comment beside each key (comments are
lost when the file is regenerated).

## 2026-10-24: the site og image moves; h264-mp4-encoder is a dev-only tool

**Decision (founder, 2026-10-24):** the site link preview gets an `og:video`
next to `og:image`: `/og.mp4`, a 3 s, 48 frame, 1200x630 H.264 Baseline loop
in which only the fire moves. Run pages keep only their still `og:image`.

- `/og.mp4` is a committed asset. `apps/web/scripts/og-video/render.ts`
  makes it again from `public/og.png` and the Paper fire layer.
- `h264-mp4-encoder@1.0.12` (MIT, 1 MB, wasm inlined, no native binary) is a
  devDependency that only that script imports. The server bundle does not
  contain it. On import it adds Emscripten `uncaughtException` and
  `unhandledRejection` handlers that rethrow, so it must never load in the
  server.
- Its mp4 has `moov` after `mdat`. `faststart` in the script moves `moov`
  first, so the file plays before it has fully downloaded.
- `twitter:card` stays `summary_large_image` and `og:type` stays as it is. X
  plays video only through approved player cards. Telegram's preview breaks
  with `twitter:player`.
- Run videos rendered on request were built and measured (about 1.8 s cold,
  480 KB each) and then left out. If they come back, the founder wants
  bigger, bolder glyphs in the run fire.

**Alternatives looked at:** an ffmpeg static binary (about 80 MB), ffmpeg.wasm
(about 30 MB of wasm), WebCodecs (not in Node), and an animated GIF
`og:image` (no platform we checked confirms that it animates).

## 2026-10-24: db imports sdk for custom rule writes

**Added:** `@tripwire/sdk` as a workspace dependency of `@tripwire/db`, and
`db → sdk` in `scripts/check-boundaries.ts`.

**What it replaces:** the custom rule write path in
`apps/web/src/lib/custom-rules.functions.ts`. The MCP server and the CLI now
create custom rules too, so the checks moved to `customRuleServices` in db,
where web and mcp both call them.

**Why:** a save must run `storedRuleIssue` from sdk, the same check the
evaluator applies. sdk is pure and imports only contracts, so the edge adds no
I/O and no cycle. The other choice was to pass the check in from each caller,
which lets a new caller skip it.

## 2026-10-25: rule outcomes, Changes needed and the Except when gate

**Decision (founder, 2026-10-25).** The approved design, with the Close
addendum, is recorded here. Stage 1 ships the engine, the contracts and the PR surfaces.
The rule card (stage 2) and the Except when editor (stage 3) come later.

**Model.** Rules stay boolean requirements. A workflow decides what happens
when a requirement does not pass. The implicit Rules workflow uses each
rule's own outcome setting. Five outcomes:

- Block: red check, one changes-requested review, and the comment.
- Ask author to fix: red check and an editable instruction. No GitHub review.
- Human review: pending check and a Tripwire review item.
- Note only: green check, and a factual note when comments are on.
- Close: the comment with the reason, red check, then Tripwire closes the
  change request. No changes-requested review, and Tripwire's earlier review
  is dismissed. Tripwire never reopens.

"Fixable" is an outcome choice, not a rule class. Remedy hints
(revise/wait/appeal) stay separate. Outcomes are never inferred from severity
or remedy.

**Contracts.**

- Verdict adds `changes_required` ("Changes needed") and `close` ("Closed").
- Actions add `request-fix` (`{ message }`) and `note` (`{ message? }`).
  Close reuses the existing `close` action.
- A per-rule outcome setting (`block | request_fix | human_review | note |
  close`, plus an instruction) on `rule_configs` and `custom_rules`, default
  `block` (migration 0041).
- Gate mode `unless` with named edge inputs (`requirement`, `exception`),
  written as `unless(requirement, exception)` in `tripwire.ts` and shown as
  "Except when".
- Response config adds `onChangesRequired`/`changesRequiredComment` and
  `onNote`/`noteComment`. Close follows the block comment settings.

**Resolution.**

1. Every reachable, independent check runs. A human review wait pauses only
   the steps that depend on its decision.
2. `unless` passes when the requirement passes or the exception passes.
   Otherwise it keeps the requirement's result, so missing or skipped
   exception proof never waives a failed requirement. The gate records
   `exceptionApplied` only when the exception waived a failed requirement.
3. Join: close > block > changes_required > needs_review > pass. Notes never
   raise the verdict. The comment keeps every active issue.
4. Approval clears only its own review item. The run verdict is then
   recomputed from what the run still holds: its close, block and fix actions
   and its other pending review items. A run stays paused while any item is
   pending.
5. The degraded floor counts enforcing checks only. Exception probes and
   note-only checks never create holds.
6. A close action raises the verdict only on a change-request event. A
   scheduled or comment run that closes keeps its old verdict.

**Close guards.** Exempt contributors get no run, so no close. A degraded run
never closes: the close is dropped and the run goes to human review. A head
that Tripwire already closed and a person reopened is not closed again: the
close becomes a Block for that head, and a new push evaluates again. A close
from a run that is not the latest for the change request is superseded.

**Closed change requests.** When the change request is closed now (its
latest lifecycle event is a close), a run records its result and takes no PR
action: no pending check, no comment, no review, no close. Its actions are
stored as suppressed. The "Block instead of close again" path applies only
after a person reopens it.

**Held verdicts.** `changes_required` and `close` count with `block` wherever
a count means "held" or "acted on": Home and org blocked stats, the daily
rollup, staff stats, analytics "blocked" activity and the open-run refresh.

**Public outputs.** The v1 webhook and Discord payload `verdict` can now be
`changes_required` or `close` (an additive enum change under v1). MCP
`list_runs`/`get_run` name every verdict value, and the CLI prints "Changes
needed" and "Closed".

**Surfaces.** One verdict comment, edited in place. Only Block submits
CHANGES_REQUESTED. When the last Block clears, Tripwire dismisses its review
even if a fix request remains. Wording: "Changes needed. Change the target to
main.", with "Human review is pending." appended when both apply. Note only:
"Tripwire passed this change request. No description provided."

**Migration.** Readers before writers: the compiler, codegen, lint, run
views, resume, replay and surfaces read the new shapes in this change.
Nothing writes a non-Block outcome yet except `setRuleOutcome` and authored
workflows. Existing rules stay Block and historical runs keep their
snapshots. The replay corpus shows no new flips.

## 2026-10-25: rules are checks, workflows decide

**Decision (founder, 2026-10-25).** A rule is a plain check. What happens on
fail (Block, Ask author to fix, Human review, Note only, Close) and Skip when
belong to workflows only. When a rule and a workflow could each block or
pass, they fought for priority in the activity and run logs.

- An installed rule on its own always blocks when it fails. The implicit
  Rules workflow wires every installed rule into one all-of gate and a block.
- The per-rule outcome setting from the entry above is gone from contracts,
  services, the rule card, Create rule, MCP and the CLI. Add exception on the
  rule card is gone too; a Skip when is built in a workflow.
- Migration 0041 added `outcome` and `outcome_instruction` to
  `rule_configs` and `custom_rules`. Migration 0043 drops them; 0041 is left
  as is because staging ran it. `moderation_items.applied_at` stays.
- A rule that one or more live workflows use shows "Used in N workflows"
  where Install would be, with a menu of those workflows.
- Rules are installed and uninstalled, not turned on and off. API, DB and MCP
  names (`enabled`, `set_rule`, `setRulesEnabled`) stay.
