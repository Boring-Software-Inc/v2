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

Superseded in part: the gate is shown as "Skip when", a card before a rule
group. The code form `unless(...)` and the semantics below are unchanged.

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

## 2026-10-26: tsrs is the primary workspace typechecker

**Added:** `tsrs@0.20.0-ts7.1.0-beta` as an exact root devDependency.
It targets TypeScript 7.1.0-beta at Microsoft commit
`3e9236361fa97a9e6c685f4833ac457ae2d8c50a`. Platform binaries are pinned
through its optional dependencies and `bun.lock`; CI and CLI release use
Bun 1.4.4, matching `packageManager`.

**Runtime:** the last green CI run before this change used Bun 1.4.4
(`latest` at the time). The initial 1.3.13 pin downgraded CI; both subsequent
attempts timed out on the ended-ban MCP integration test, with all other
3,838 tests passing. Pin the previously green 1.4.4 exactly to preserve a
reproducible toolchain. Its frozen install preserves `bun.lock`, and all 15
tsrs workspace checks pass on Linux x64. The exact timeout was not reproduced
locally, including Linux x64 with a clean install, so the underlying runtime
failure remains unconfirmed. The integration test retains its five-second
deadline and also asserts a successful tools-list payload.

**What it replaces:** TS5 `tsc --noEmit` in all 15 workspace `typecheck`
scripts, including CI and the CLI release check. The founder authorized the
swap after the same-commit experiment measured full-suite medians of
23.805s for TS5, 6.422s for matching Microsoft TS7, and 2.063s for tsrs.
Each had one warmup followed by three measured runs, including route
generation. Install time was excluded.

**Why the stack can't do it:** Bun transpiles without checking types, Biome
lints without semantic typechecking, and the existing TS5 JavaScript compiler
does not provide a compiled native checker. The matching TS7 comparison also
showed a lower full-suite median for tsrs on this checkout.

**Configuration:** four checkers and `--fast false` explicitly retain the
verified reference mode. Explicit `bun` and, where previously discovered,
`pg` ambient types preserve TS5's inputs; web retains `vite/client` and
`node`. Relative `paths` replace web's removed `baseUrl`, including its bare
specifier fallback. File includes, strictness and skip flags stay intact.
Routes are generated without a dev server before web typechecking.

**Retained:** `typescript` stays at root and in web for the TS5 compiler API
used by `@typescript-eslint/parser` and existing tooling. `bun run
typecheck:ts5` checks every workspace with TS5 for diagnosis; `bun run
typecheck` and CI use tsrs. No runtime imports or build emitters change.

**Tradeoff:** this is an experimental compiler and a TS7 beta language/library
upgrade. The release still documents repository conformance failures;
matching clean diagnostics, file graphs and injected-error rejection here do
not prove equivalent diagnostics on every future change. Compare a suspect
case with `bun run typecheck:ts5` and the pinned Microsoft TS7 reference before
attributing it to application code. See the release-specific
[compatibility](https://github.com/oxc-project/tsrs/blob/v0.20.0/docs/COMPATIBILITY.md)
and [defaults](https://github.com/oxc-project/tsrs/blob/v0.20.0/docs/DEFAULTS.md).

## GitCafe foundation: separate identity and forge-qualified repository scope (2026-10-27)

The owner authorized GitCafe integration beyond the old second-forge deferral. The first slice repairs namespace isolation before activation. `gitcafe` keeps its distinct catalog ID and canonical origin `https://git.cafe`; historical `opengit` data, origin, issuer, credentials, and paused status are preserved. No migration equates their IDs.

Repository service scopes use `{ forge, fullName }`; runs derive forge from their triggering event. Org permissions remain tenant boundaries, and a Tripwire org can contain multiple forges. Ambiguous names fail closed. Event uniqueness becomes `(forge, delivery_id)` through migration 0045; deploy the targetless-conflict ingest code before replacing the old index. See [migration risks and acceptance evidence](docs/research/git-cafe-foundation.md).

GitCafe remains planned and unavailable for sign-in, connection, ingest, reads, and actions. Its package home is defined by the decision below. Account-age/global reputation features stay unavailable without invented evidence; when GitCafe is surfaced, retain disabled controls with reasons. Team/org reviewer actors and ongoing GitHub-sync webhooks remain unverified pending live tests, with no hard-coded exclusion based on the initial audit.

## GitCafe protocol package home (2026-10-27)

The owner explicitly authorized a dedicated `packages/forge-gitcafe` workspace after reviewing the initial OpenGit subpath placement. This is a scoped exception to the closed package layout and replaces `@tripwire/forge-opengit/gitcafe` with `@tripwire/forge-gitcafe`. Separate protocol ownership cannot be expressed clearly under the legacy adapter's name. No third-party dependency is added.

GitCafe code and captured fixtures live in the new package. Historical OpenGit exports, issuer, credentials and data remain in `packages/forge-opengit`; neither forge package imports the other. GitCafe follows the adapter dependency boundaries: contracts, utils and forge only, with worker and API as permitted consumers. This slice contains protocol primitives only; no adapter, receiver or sign-in is activated. Captured response bytes and provenance are preserved through the move. Authenticated token and lifecycle fixtures await an authorized staging app.


## 2026-10-27: Staging integration branch

Staging work merges into `staging`. Independent staging PRs target that branch;
stacked PRs may target their parent feature branch, with the stack root targeting
`staging`. Production promotion is a separate PR from `staging` into `main`.
The staging CLI release dispatches from `staging` and publishes only to the
`staging` npm tag. The former `staging/visual` tip is preserved as
`archive/staging-visual`.

## GitCafe explicit person grant is authorization delegation (2026-10-27)

The owner authorized the connect-only API grant foundation while GitCafe remains
planned. Both the grant plugin and sign-in provider use the existing configured
GitCafe auth client; this adds no independent enablement flag or UI availability
rule. Repository connection remains unavailable pending the parent-owned shared
readiness policy, genuine person-read evidence and worker adapter work.

An approved Tripwire user's current session and fresh target-org
`connections:manage` permission authorize initiation. The explicit GitCafe grant
may represent a subject that signs into a different Tripwire account. Its API
credential delegates external authority to the initiating user for the bound org
and intended installation; it does not authenticate that subject into Tripwire.
The grant never creates or reassigns `account` or `forge_identities`, issues a
session, merges by email, approves another account or inherits its permissions.
Proof evidence preserves both the local user/session and the remote subject/actor
IDs. The generated protocol suite covers an existing foreign account without any
account, identity, user or session mutation. Sign-in/linking uniqueness and failed
signup guards retain their existing policy and regression tests.

The grant reuses the registered `/api/auth/callback/gitcafe` URI, with fixed
`openid profile email repo:metadata:read` scopes and `https://git.cafe/api` resource.
Persisted server context classifies callbacks without consuming sign-in state;
Better Auth's state parser still checks the signed browser cookie and expiry.
Connect callbacks, including errors and attempts at another provider callback,
terminate before the sign-in handler. A separate atomically consumed server nonce
fences replay across auth instances. Login and delegation share the same signed
claim verifier. Userinfo must match its verified subject; principal supplies a
separate actor ID with the same access token.

Only a random opaque handle leaves the callback. Better Auth's existing
`symmetricEncrypt`/`symmetricDecrypt` encrypt the proof with HMAC-derived,
purpose-separated key material from the auth secret. No crypto implementation or
dependency is added. The proof is stored in the existing verification store,
bound to purpose, forge, org, intended installation, user and session; its expiry
is the minimum of flow expiry, five minutes and token expiry. Refresh and ID
tokens are discarded; account token storage is untouched. Expired ciphertext is
cleaned by Better Auth's verification-store cleanup and cannot authorize use.

The narrow handoff is the pathless `auth.api.consumeGitCafeConnectProof` endpoint
on a configured auth instance. It requires the same fresh authoritative session,
approval, org permission and installation binding before atomic one-use consume;
its returned credential is for trusted server code only and must never be
serialized to a browser. No worker imports auth, and no worker transport, queue
payload or shared decryption abstraction is invented. A future claim needs an
explicit allowed-layer credential handoff plus fresh person binding, bot-read
current membership/role, expected active app/installation, selected repositories,
Tripwire permission and unique-claim verification. This proof alone is never an
installation ownership or administrator claim, and no GET or POST claim is added.

### 2026-10-28 — GitCafe connection storage and isolated staging verification

The current build step connects the dedicated GitCafe staging installation after
explicit confirmation. `Forge`/`forgeSchema` now admit GitCafe repository rows via
the catalog's `connection` status, independently of `IngestForge`/
`ingestForgeSchema`. This permits forge-qualified repository ownership, org
routing, Home, and the picker without claiming an evaluation adapter exists.
GitCafe's worker runtime and normalizer are explicitly null; webhook ingest,
re-runs, action retries, repository arming, and workflow protection enabling
remain unavailable. GitHub and historical OpenGit retain their current behavior.

A consumed server-only person proof becomes a strict, five-minute action job
containing user/session/org/installation, verified subject/actor, authorization
and expiry timestamps, and request ID. No bearer credential, private key, or
reusable authorization secret enters pg-boss. The worker rechecks current local
session posture and target-org connections:manage, fresh bot-read org-owner or
org-admin membership for that actor, active expected app/installation, selected
repository stable identities, and unique installation/repository ownership. It
revalidates remote authority immediately before the atomic ownership mutation;
new and refreshed GitCafe rows stay unarmed. Generic claim/move paths refuse
GitCafe. No GET claims an installation, and no account or identity is linked.

`WORKER_MODE=gitcafe-connect` is an operational staging verification mode. It
requires Unkey's actual `preview` environment slug and the captured dedicated
Tripwire Staging app ID `int_01m60999c0fqg841d48s29qwtv`; this concrete pin excludes
production and is not a general integration activation flag. It starts only the
connection queue and health endpoint, without the general deployment fence,
normal queue registration/consumption, pg-boss scheduling, schema migration, or
maintenance. Existing queue schema must already exist. The stopped staging
worker's event/action/schedule backlog must remain untouched. No deployment or
production enablement is authorized by this code change.

The worker uses the existing `@tripwire/forge-gitcafe` installed-client package;
no new external dependency, package, adapter, or deployment SDK is introduced.
Login and Connect consume one exact public provider availability result,
`{ available: ConfiguredSignInProviderIds }`, so advertised availability cannot
split into independent login and connection lists. Membership and repository
schemas are grounded in the genuine authorized staging captures with independent
original-byte/provenance/privacy validation recorded in their sidecars.

### 2026-10-28 — Bounded connection failure logging in the web head

The web workspace declares the existing stack's `pino@^10.3.1` dependency for
GitCafe confirmation failures. It replaces silent catch-only handling at that
edge; pg-boss and TanStack Start do not provide the required structured pino
logging. Logs contain a generated request ID and a fixed failure code, never
provider response bodies, delegated credentials, actors, or email addresses.
No new third-party library is introduced.

## GitCafe delegated subject is the membership actor (2026-10-28)

GitCafe's founder confirmed that the signed OIDC `sub` is the permanent,
non-reused person account key. Staging independently matched the authenticated
account subject to the same person's organization-membership `actorId`. The
API-resource OAuth token succeeds at userinfo but receives 403 at
`/api/auth/principal`; that endpoint is not required for the connection flow.

This supersedes the separate-principal requirement above. The signed ID-token
subject, checked against live same-token userinfo, supplies both proof `subject`
and membership `actorId`. Confirmation rechecks userinfo and rejects differing
proof IDs before enqueueing. The worker still requires current complete-page
org-owner/admin membership, installation snapshot fencing, selected-repository
validation, local permissions and atomic claim uniqueness. Handles, profile data
and email never authorize a claim. No ingestion or protection is enabled.

Source: [GitCafe OIDC guide](https://git.cafe/docs/integrations/sign-in-with-gitcafe),
founder response relayed by Grim, and a read-only staging equality check. The
equality result is live evidence, not a captured provider-response fixture.

## 2026-10-28 — GitCafe read client uses the forge interface workspace

The concrete GitCafe read client declares the existing internal `@tripwire/forge` workspace dependency for universal commit and contributor types. This follows the approved adapter dependency arrow and replaces duplicate local representations of those types. The existing stack already supplies the interface package; no third-party dependency is added. Historical OpenGit remains separate.

## 2026-10-28 — GitCafe staging protection execution and action receipts

Grim requested completion of GitCafe protection, beyond repository connections. The first executable path stays isolated to Unkey preview and the dedicated Tripwire Staging app. Its process, resume, rerun and refresh queues are separate from the ordinary worker queues; queue-scoped supervision and durable receipt recovery leave general backlog and schedules untouched. Historical parked deliveries are not activated during rollout.

Signed receipts retain their exact raw bytes. Dispatch atomically creates the GitCafe event and its job; a dispatched receipt remains recoverable until processing finishes. Installation lifecycle authority and fresh installed-client scope fences apply to reads and actions. A persisted action, current claimed repository and installation establish the write binding. Review creation retains its immutable request ID and input in the existing validated action JSON; comment creation retains an operation marker and permits one dispatch, reconciling uncertain results rather than blindly resending. Only the installation bot's artifacts may be edited or dismissed.

GitCafe supplies diff, commit, profile-text and repository-local evidence. Account age, complete contributor-wide history and global merge history remain unavailable. Their controls remain disabled with source-specific reasons. Explicitly omitted patches cannot establish a clean text scan or an AI verdict; existing AI prompts remain unchanged. Capability declarations describe these reads without enabling the catalog's protection gate. Catalog activation, staging rollout and required-check enforcement require separate scratch acceptance evidence.

## 2026-10-28 — GitCafe clearance waits for settled review submissions

GitCafe actions serialize by installation, repository and subject through a dedicated PostgreSQL session-lock pool. A dispatched blocking review retains its immutable request ID until a verified receipt is stored. Clearance replays uncertain submissions with that same input before enumerating and dismissing owned reviews; a lost response or an expired cleanup retry cannot release a successful check. Definitive first-attempt refusals do not leave an uncertain submission behind. General worker queues remain unchanged.

Initial and resumed GitCafe evaluations commit audit steps, moderation state and workflow action intents atomically. Recovery uses the committed evaluation and exact recorded surface intents, with a separate surface key for each applied moderation decision. It never reruns evaluation to repair remote delivery.

The omitted-patch policy is versioned as `crypto-address@2` and `ai-review@3`. Older versions retain their original evaluation behavior; GitCafe requires the versions that distinguish unavailable patches. AI instruction and prompt bytes are unchanged from `ai-review@2`. Declaring GitCafe review delivery enables correct surface planning only; the catalog protection gate remains closed pending live acceptance.

Saved AI and crypto workflow references remain enableable through an explicit map of their frozen config schemas after the current catalog advances. Unknown versions remain invalid; validation does not rewrite stored definitions or audit snapshots. The existing standalone-rule policy still advances compatible configs to the current version. This avoids making an existing GitHub workflow unrunnable solely because GitCafe needs a new evidence policy.

Surface intents also bind the committed verdict, head and complete sorted set of applied moderation decisions. Planning reads a consistent audit under the run lock; insertion and review-body stamping compare that phase under the same lock. Dispatch rechecks it alongside installation authority. An older approval cannot clear a later denial within the same run. Terminal GitCafe rerun retries recover committed surfaces without reevaluating rules.

An action's originating phase is immutable. A newer surface transaction supersedes obsolete intents before they can dispatch; it records a new action when a previously undelivered block or close remains required. Uncertain old review commands remain retained for later clearance reconciliation. Run status participates in the phase, including `closed`; closing moderation and recording its neutral check/comment commit together, leaving the scoped sweeper able to recover delivery after a crash.

GitCafe response refresh uses that same committed-evaluation planner and phase-fenced insertion. Its stable queue job ID identifies refresh intents; retrying a refresh reuses those intents. A refresh captured before moderation closes cannot overwrite the neutral closure check. Configured sole-review changes retain the owned replacement-before-dismissal protocol.
