# Implicit state machine audit

Audit baseline: `staging` at `2ecf9787` on 2026-11-05.

This is a static architecture audit. It does not claim that every listed risk is
an observed bug. It identifies behavior that is already state-machine-shaped but
whose transition model is spread across flags, timestamps, persistence rows,
callbacks, retries, or provider state.

## Definition

For this audit, an implicit state machine has all four of these properties:

1. A bounded state value exists, even if it is represented by several booleans,
   nullable fields, timestamps, maps, or related rows.
2. Events or operations move the system between states.
3. Guards make some transitions legal only from certain states.
4. State-dependent effects occur, such as database writes, queue work, remote
   forge mutations, navigation, or UI changes.

Simple status display, one-off branching, immutable graph interpretation, and
ordinary request pipelines are excluded. Explicit machines with a state union,
event union, and centralized reducer or transition table are also excluded from
the findings. They appear under "Useful counterexamples."

## Method

The repository was split into three independent read-only scans:

- `apps/web`: 757 TypeScript and TSX files were enumerated. Broad state-bearing
  searches matched 419 files, followed by manual tracing of the strongest
  candidates.
- Backend and persistence: 481 files under `apps/worker`, `apps/api`, `apps/mcp`,
  `apps/cli`, `packages/db`, and `packages/auth`, including every persisted status
  field and its writers, consumers, and recovery paths.
- Domain and adapters: 276 TypeScript files under contracts, core, forge
  adapters, utils, and SDK. The scan covered 60,837 production lines and manually
  traced 103 state-pattern candidates.

Findings were then reconciled across layers. When several scans described the
same lifecycle, this report treats it as one end-to-end machine and calls out
meaningfully independent sub-machines.

## Priority model

- **Critical:** a transition error can duplicate or lose external effects,
  bypass authority, strand durable work, or make recovery unsafe.
- **High:** a transition error can lose user work, produce a wrong verdict,
  misapply a human decision, or create a persistent inconsistent state.
- **Medium:** the machine is complex enough to merit an explicit model before it
  grows, but current blast radius is contained or recoverable.
- **Low:** a real machine exists, but the current implementation is small and its
  failure modes are limited.

## Inventory

| ID | Priority | Machine | Main reason to think further |
| --- | --- | --- | --- |
| ISM-01 | Critical | Webhook ingestion and evaluation | A normalized event can be skipped on retry before evaluation finishes. |
| ISM-02 | Critical | Workflow execution, pause, and resume | Node and run state is distributed across outcomes, deferred work, pause records, and terminal booleans. |
| ISM-03 | Critical | GitCafe receipt and installation authority | Receipt state, authority, generation, provider revision, and queue recovery jointly decide legality. |
| ISM-04 | Critical | GitCafe action delivery reconciliation | Ambiguous remote delivery requires local claims, markers, receipts, and readback to agree. |
| ISM-05 | Critical | GitCafe credential and installation client | Generations, caches, in-flight work, and repeated authority guards form a security-sensitive machine. |
| ISM-06 | High | Persisted run and outbound-action lifecycle | Run terminality and action terminality are spread across workers, moderation, recovery, and supersession. |
| ISM-07 | High | Moderation decision and application | A durable decision and its application are separate phases without one aggregate state. |
| ISM-08 | High | Response surface and forge artifact lifecycle | Verdict transitions, redaction, comments, reviews, and adapter capabilities select remote effects. |
| ISM-09 | High | Cross-forge check and rerun lifecycle | Abstract check state and provider-specific transitions differ materially. |
| ISM-10 | High | GitCafe connection authorization | OAuth flow records, one-time proof records, UI URL state, and backend jobs jointly encode progress. |
| ISM-11 | High | Workflow editor orchestration | Editing, live revisions, connection gestures, saves, and navigation blocking can form invalid cross-products. |
| ISM-12 | High | Save queue and navigation guard | A commit result can settle against edits made after the submitted snapshot. |
| ISM-13 | Medium-high | Workflow push proposal and review | Stored status and time/drift-derived effective status are different machines. |
| ISM-14 | Medium | Agent workflow draft and presence leases | Open can mean live or expired; presence and node ownership are time-derived. |
| ISM-15 | Medium | Setup progress ledger | Stages can be overwritten or skipped based on arrival order without a centralized transition policy. |
| ISM-16 | Medium | Shared browser EventSource | Module globals, callbacks, timers, visibility, and subscriber count jointly encode connection state. |
| ISM-17 | Medium | Account deletion wizard | An outer wizard and nested per-repository shutdown machine can diverge during partial completion. |
| ISM-18 | Medium | DataBuddy flag synchronization | Database status, queue retry, remote rules, and deletion tombstones have different terminal semantics. |
| ISM-19 | Medium | Scheduled workflow clock | Enabled state, timing equality, last tick, and wall clock decide replay and deduplication. |
| ISM-20 | Medium | Collection URL synchronization | Local state, router state, and a finite self-write history infer navigation ownership. |
| ISM-21 | Low-medium | Synced-list polling | Mutation state, polling, sync timestamps, and a deadline jointly determine completion. |
| ISM-22 | Low-medium | OAuth popup completion | Delivery mode, opener reachability, terminal view, and navigation are guarded by a one-shot ref. |
| ISM-23 | Low | GitHub and OpenGit token caches | Cache presence and expiry imply missing, valid, expiring, minting, and failed states. |
| ISM-24 | Low | Per-evaluation signal load promises | Promise presence and settlement encode unloaded, in-flight, fulfilled, and sticky-rejected states. |

## Detailed findings

### ISM-01: Webhook ingestion and evaluation

**Inferred states:** absent, raw and queued, normalized, evaluated or no-run,
quarantined, and retryable preparation failure.

Admission, deduplication, persistence, pg-boss enqueueing, normalization,
workflow evaluation, forge effects, and live notification are owned by separate
layers. The event row exposes timestamps and booleans rather than a single
processing phase.

The most important risk is a plausible crash window for ordinary forge events.
`normalizedAt` is persisted before workflow evaluation and surface emission. A
retry sees `normalizedAt` and returns unless `resumeNormalized` is enabled. The
normal consumer does not enable it. GitCafe has a separate processed marker,
advisory locking, and explicitly resumes normalized work, so the recovery policy
is not consistent across forges.

**Important code:**

- `apps/api/src/routes/webhooks.ts:53-106`
- `packages/db/src/services/events.ts:43-143`
- `apps/worker/src/jobs/process-event.ts:79-118`
- `apps/worker/src/jobs/process-event.ts:120-227`
- `apps/worker/src/jobs/process-event.ts:365-428`
- `apps/worker/src/index.ts:283-302`

**Recommendation:** make normalized-but-not-evaluated work durably resumable and
idempotent. Add failure injection after normalization, after run persistence,
after forge effects, and before final notification.

### ISM-02: Workflow execution, pause, and resume

**Inferred node states:** unreached, deferred, pass, fail, skipped, paused, and
resumed. **Inferred run states:** evaluating, waiting for moderation,
resumed-approved, resumed-denied, and each terminal verdict.

Runtime state is distributed across `outcomes`, `conducted`, `deferred`,
`paused`, resume input, and several terminal booleans. A moderation node can look
passed, paused, or pending depending on which structure a caller reads. Resume
reconstructs earlier outcomes, conducts the paused target, and activates the
chosen decision edge.

This makes impossible combinations representable and makes new action or verdict
types require coordinated edits across traversal, persistence, resume, display,
and verdict reduction.

**Important code:**

- `packages/core/src/workflow/executor.ts:20-78`
- `packages/core/src/workflow/executor.ts:106-147`
- `packages/core/src/workflow/executor.ts:175-240`
- `packages/core/src/workflow/executor.ts:242-325`
- `packages/core/src/workflow/executor.ts:328-391`

**Recommendation:** define a written node and run transition table first. Then
consider replacing the parallel collections with discriminated execution state
that makes illegal combinations unrepresentable.

### ISM-03: GitCafe receipt and installation authority

This is a coupled pair of durable machines.

**Receipt states:** pending, malformed, parked, dispatched, applied, and stale.
Queue recovery can recreate missing jobs while a receipt remains dispatched.

**Authority states:** reconcile-required, active, paused, and terminal
uninstalled. Effective authority also depends on generation, `authorityAt`,
provider version and revision, pending revocation receipts, and repository
selection.

Correctness depends on event time, authority time, provider revision, generation,
and queue state agreeing. A status value alone does not tell a caller whether an
action is legal. Queue recovery is part of the business transition model rather
than only an infrastructure concern.

**Important code:**

- `packages/db/src/schema/gitcafe-lifecycle.ts:16-62`
- `packages/db/src/services/gitcafe-lifecycle.ts:450-608`
- `packages/db/src/services/gitcafe-lifecycle.ts:610-690`
- `packages/db/src/services/gitcafe-lifecycle.ts:705-846`
- `packages/db/src/services/gitcafe-lifecycle.ts:849-1081`
- `apps/worker/src/gitcafe-lifecycle-consumer.ts:27-97`

**Recommendation:** extract pure receipt and authority transition decisions and
document their cross-machine invariants, especially generation reuse, pending
revocations, and dispatched receipts under inactive authority.

### ISM-04: GitCafe action delivery reconciliation

**Inferred states:** absent, prepared, claimed, dispatched, ambiguously
delivered, observed by marker or readback, receipt-recorded, superseded,
released, and retryable.

Comments and reviews persist intent before network dispatch. Deterministic
failures release the claim, while ambiguous failures retain uncertainty. Retry
must inspect provider markers, receipts, version guards, or readback rather than
blindly repeat the remote mutation.

This is a necessary machine, but its states are encoded by nullable fields,
store return values, provider artifacts, and branches inside one large adapter.
A missed release or receipt condition can either duplicate an effect or suppress
retry forever.

**Important code:**

- `packages/contracts/src/gitcafe-action.ts:71-102`
- `packages/forge-gitcafe/src/actions.ts:50-64`
- `packages/forge-gitcafe/src/actions.ts:243-468`
- `packages/forge-gitcafe/src/actions.ts:471-595`
- `packages/forge-gitcafe/src/actions.ts:598-847`

**Recommendation:** document persisted operation states and failure classes,
then introduce a shared transition vocabulary for prepare, claim, reconcile,
confirm, release, and terminate.

### ISM-05: GitCafe credential and installation client

**Inferred states:** unknown, lookup-in-flight, active snapshot,
mint-in-flight, cached-valid, cached-expiring, generation-invalidated, inactive,
expired, and failed.

The client implements this with several maps, a weak map, generation checks,
timestamps, coalesced promises, and repeated authority guards. Scope or
installation changes must invalidate lookups, minting, and tokens. Old in-flight
work must not repopulate a newer generation. Authority is checked before remote
I/O and again after it.

This is security-sensitive because every async boundary must preserve the same
generation and lifecycle invariants.

**Important code:**

- `packages/contracts/src/gitcafe-installation.ts:26-53`
- `packages/forge-gitcafe/src/installation-client.ts:58-112`
- `packages/forge-gitcafe/src/installation-client.ts:468-613`
- `packages/forge-gitcafe/src/installation-client.ts:619-697`
- `packages/forge-gitcafe/src/installation-client.ts:699-857`

**Recommendation:** represent each installation with one discriminated runtime
state and one generation boundary, while retaining repeated authority checks at
remote boundaries.

### ISM-06: Persisted run and outbound-action lifecycle

**Run states:** queued, running, paused, completed, failed, and effectively
closed. **Action states:** recorded, executed, suppressed, and superseded.

The real machine spans schema comments, run mutators, moderation, reruns, surface
emission, delivery jobs, and the recovery sweeper. `superseded` currently means
several different things: stale ownership, invalid payload, replacement, or
give-up abandonment. Some settlement, pause, and failure writes do not predicate
on the prior state.

Run terminality also depends on moderation and action rows, but the database does
not encode that aggregate invariant.

**Important code:**

- `packages/db/src/schema/runs.ts:13-50`
- `packages/db/src/schema/runs.ts:92-123`
- `packages/db/src/services/runs.ts:130-210`
- `packages/db/src/services/runs.ts:309-455`
- `packages/db/src/services/runs.ts:593-745`
- `packages/db/src/services/runs.ts:996-1130`
- `apps/worker/src/jobs/sweep-actions.ts:76-229`
- `apps/worker/src/jobs/sweep-actions.ts:239-289`

**Recommendation:** centralize guarded transitions and separate action lifecycle
status from termination reason.

### ISM-07: Moderation decision and application

**Decision states:** pending, approved, denied, and closed. **Application states:**
unapplied and applied. **Run states:** paused, completed, or closed.

A human decision is committed separately from applying it to workflow execution.
That separation is valid, but no aggregate names the combined phase. The true
state is a cross-product of moderation status, `appliedAt`, run status, recorded
actions, and queue state. Consumers can mistake decided for applied, and recovery
differs between GitCafe and ordinary forge paths.

**Important code:**

- `packages/db/src/schema/moderation.ts:5-32`
- `packages/db/src/services/moderation.ts:37-167`
- `packages/db/src/services/moderation.ts:281-408`
- `packages/db/src/services/moderation.ts:503-544`
- `apps/worker/src/jobs/resume-run.ts:91-204`
- `apps/worker/src/jobs/resume-run.ts:206-416`

**Recommendation:** name the decision-application phases and test every crash
boundary from decision persistence through surface emission.

### ISM-08: Response surface and forge artifact lifecycle

**Inferred states:** no prior verdict, stable verdict, verdict transition;
comment absent, desired, conditional, or deleted; review absent, active, sole
response, pointer response, stale, or dismissed.

The surface planner chooses comment and review effects from previous and current
verdicts, response configuration, redaction, notes, and review presence. The
forge adapters then reconcile those effects against markers, remote review
state, and provider capabilities. GitHub can edit and supersede an active
artifact; OpenGit is append-only and intentionally creates a different history.

Redaction can turn an intended update into deletion. Concurrent runs can race on
the single active marker. New verdicts or response surfaces increase an already
large decision matrix.

**Important code:**

- `packages/contracts/src/comment-render.ts:95-135`
- `packages/contracts/src/comment-render.ts:896-956`
- `packages/contracts/src/response.ts:272-305`
- `packages/forge/src/index.ts:97-166`
- `packages/forge-github/src/actions/comment.ts:20-99`
- `packages/forge-github/src/actions/execute.ts:196-220`
- `packages/forge-opengit/src/actions/execute.ts:44-67`

**Recommendation:** convert the planner into an exhaustive decision table and
define adapter capability deviations explicitly.

### ISM-09: Cross-forge check and rerun lifecycle

**Inferred states:** missing, queued, in-progress, completed with conclusion,
rerequested, and stale.

GitHub may update the newest owned check or create a new one rather than reopen a
completed check. GitCafe maps abstract pending to a completed provider result,
then a provider rerun returns it to queued. GitCafe rerun acceptance also depends
on timestamp ordering, current head identity, pull state, and check ownership.

The abstract state and provider transitions are split across contracts and
adapters, so semantic drift is possible when a new conclusion or rerun behavior
is added.

**Important code:**

- `packages/contracts/src/check.ts:3-22`
- `packages/contracts/src/gitcafe-check.ts:18-76`
- `packages/forge-github/src/actions/check.ts:24-76`
- `packages/forge-gitcafe/src/actions.ts:99-131`
- `packages/forge-gitcafe/src/checks.ts:18-162`

**Recommendation:** define a forge-neutral transition matrix and list each
adapter's intentional deviation beside it.

### ISM-10: GitCafe connection authorization

**Backend states:** flow-issued, callback-classified, nonce-consumed,
tokens-validated, proof-issued, proof-consumed, expired, refused, provider-denied,
and consumed. **Frontend states:** choosing org, awaiting authorization,
confirming proof, job pending, connected, refused, error, and reauthorizing.

The backend state is represented by several prefixed verification records plus
Better Auth OAuth state. The frontend phase is inferred from local selection,
URL fields, proof handle, mutation data, job ID, polled job status, and redirect
effects.

Correctness depends on matching serialized flow values and expiry windows.
Concurrent callback and proof consumption are security-critical. On the client,
stale URL fields or changed org selection can create hard-to-explain recovery
paths.

**Important code:**

- `packages/auth/src/gitcafe-connect.ts:43-91`
- `packages/auth/src/gitcafe-connect.ts:101-187`
- `packages/auth/src/gitcafe-connect.ts:190-382`
- `packages/auth/src/gitcafe-oidc.ts:40-127`
- `apps/web/src/components/organizations/gitcafe-install-setup.tsx:57-183`
- `apps/web/src/components/organizations/gitcafe-install-setup.tsx:224-271`
- `apps/web/src/components/organizations/gitcafe-connection-progress.tsx:37-122`

**Recommendation:** document one security transition table, give each backend
transition a typed name, and derive the frontend phase from one discriminated
route state.

### ISM-11: Workflow editor orchestration

The editor combines several machines: clean or dirty persistence, canvas or
code view, drag state, connection creation, insertion, reconnection, live
revision decoration, problem navigation, selection, and route blocking.

Independent flags and refs allow impossible cross-products. A pending connection
can be stranded, reconnect refs can become stale, and live revisions can replace
nodes and edges without checking local dirtiness. Save or enable operations can
also race with graph changes.

**Important code:**

- `apps/web/src/components/workflows/editor/workflow-editor.tsx:400-552`
- `apps/web/src/components/workflows/editor/workflow-editor.tsx:997-1073`
- `apps/web/src/components/workflows/editor/workflow-editor.tsx:1134-1248`
- `apps/web/src/components/workflows/editor/workflow-editor.tsx:1364-1495`

**Recommendation:** separate editing, connection gesture, live revision, and
persistence into explicit cooperating machines.

### ISM-12: Save queue and navigation guard

**Inferred states:** clean, dirty, committing, failed with edits, partially
committed, navigation blocked, and navigation proceeding.

Queue contents, `isCommitting`, router blocker state, and the `leaving` ref form
one compound machine. The highest-confidence risk is snapshot settlement:
`commitFn(pending)` submits one snapshot, but the result is applied to the latest
`prev`. Because controls remain editable during commit, success for an older
snapshot can clear newer edits. Partial failure can classify newer values using
the older result.

**Important code:**

- `apps/web/src/components/save-queue/save-queue-context.tsx:71-115`
- `apps/web/src/components/save-queue/save-queue-context.tsx:131-194`
- `apps/web/src/components/save-queue/save-queue-context.tsx:211-259`

**Recommendation:** assign commit generations or reconcile the result only
against the exact submitted snapshot.

### ISM-13: Workflow push proposal and review

**States:** pending, accepted, rejected, expired, and stale. A blocked decision
is not persisted as a state.

The same stored pending row can read as expired or stale based on time and drift.
Decision handling later persists those derived states. Different readers can
therefore disagree if they use stored status versus effective status. Accepted
workflow changes commit before post-transaction draft promotion, leaving a
recoverable follow-up that is not represented in proposal state.

**Important code:**

- `packages/db/src/schema/workflow-pushes.ts:7-35`
- `packages/db/src/services/workflow-pushes.ts:190-259`
- `packages/db/src/services/workflow-pushes.ts:313-348`
- `packages/db/src/services/workflow-pushes.ts:437-540`
- `apps/cli/src/push-review.ts:33-60`

**Recommendation:** use one effective-state function everywhere and separate
persisted decision from time/drift availability and post-acceptance follow-up.

### ISM-14: Agent workflow draft and presence leases

**Draft states:** open-live, open-expired, promoted, and discarded. **Presence
states:** active, stale, and finished. Node touches are held, replaced, released,
or expired.

Stored `open` can mean live or expired. The unique partial index still treats an
expired row as open until a later write discards it. Presence can revive after a
new touch. Push acceptance also depends on an external draft ID and revision
mark.

**Important code:**

- `packages/db/src/schema/agent-work.ts:19-93`
- `packages/db/src/services/agent-work.ts:107-201`
- `packages/db/src/services/agent-work.ts:448-513`
- `packages/db/src/services/agent-work.ts:630-719`
- `packages/db/src/services/agent-work.ts:797-980`
- `packages/contracts/src/agent-work.ts:102-203`

**Recommendation:** centralize effective draft state, guard close and update by
current state, and document expired-but-stored-open behavior.

### ISM-15: Setup progress ledger

**Inferred states:** not started, active, waiting, completed, skipped, failed,
expired, taken over, and completed run.

Each stage is a last-write-wins record. Reporting a later stage fills missing
earlier stages as skipped, and the final verification stage marks the entire run
complete. A report can overwrite an earlier stage status, and transition
legality is not centralized. Agent liveness and UI display are separately
derived from `lastReportAt`, `completedAt`, stage timestamps, and dismissal.

**Important code:**

- `packages/contracts/src/setup.ts:3-73`
- `packages/db/src/services/setup.ts:65-111`
- `packages/db/src/services/setup.ts:120-185`
- `packages/db/src/services/setup.ts:204-272`
- `apps/web/src/components/setup/agent-setup-card.tsx:134-166`
- `apps/mcp/src/tools.ts:1404-1431`

**Recommendation:** decide whether stage regression and repeated reports are
legal, then encode that policy in a pure transition function with tests.

### ISM-16: Shared browser EventSource

**Inferred states:** unsupported, idle, opening, connected, temporarily lost,
closed awaiting retry, resyncing, and idle cleanup.

Module globals for source, connectivity, loss, retry, handlers, and attachment
form the machine. Transitions occur in subscription code, EventSource callbacks,
timers, visibility handlers, and last-subscriber cleanup. Old source callbacks
are not guarded by a generation token, so a replaced source can still mutate
global connection state.

**Important code:**

- `apps/web/src/lib/live-stream.ts:9-42`
- `apps/web/src/lib/live-stream.ts:44-114`
- `apps/web/src/lib/live-stream.ts:116-155`

**Recommendation:** use a discriminated connection state and source generation.

### ISM-17: Account deletion wizard

An outer wizard coordinates loading, blocked, repo shutdown, checks, confirmation,
deleting, and signed-out phases. Each repository independently moves through on,
turning-off, off, or failed.

The original flow is frozen while plan data can refresh. Cancel remains
available during sequential repo shutdown, so visible local progress can vanish
while server operations continue. Partial retry and final-step eligibility are
derived from several independent values.

**Important code:**

- `apps/web/src/components/account/delete-account-dialog.tsx:56-147`
- `apps/web/src/components/account/delete-account-dialog.tsx:198-225`
- `apps/web/src/components/account/delete-account-dialog.tsx:287-379`
- `apps/web/src/components/account/delete-account-dialog.tsx:384-559`

**Recommendation:** use a hierarchical reducer and define cancellation behavior
during partial server completion.

### ISM-18: DataBuddy flag synchronization

**States:** pending, synced, retryable failure, terminal missing, and removal
awaiting provider confirmation.

The logical state spans the override row, attempts and error fields, pg-boss
retry state, provider rules, and deletion tombstones. The missing-flag path
persists a failure but returns without throwing, so it is terminal from the
queue's perspective while sharing the same database status as retryable failure.

**Important code:**

- `packages/db/src/schema/staff.ts:18-45`
- `packages/db/src/schema/staff.ts:68-84`
- `packages/db/src/services/flag-overrides.ts:217-281`
- `packages/db/src/services/flag-overrides.ts:291-423`
- `apps/worker/src/jobs/sync-flag-overrides.ts:21-75`

**Recommendation:** persist distinct retryable, terminal-missing, and provider-
unavailable reasons and test database state against queue behavior.

### ISM-19: Scheduled workflow clock

**Inferred states:** disabled, newly enabled or restarted, active unchanged, not
due, due, and fired or advanced.

The machine is represented by `enabled`, saved versus current timing, nullable
`lastTickAt`, wall clock, and helper composition. The due instant doubles as tick
identity for retry deduplication. Schedule changes near a tick can replay or skip
work if the baseline rules drift.

**Important code:**

- `packages/contracts/src/workflow-schedule.ts:110-154`
- `packages/contracts/src/workflow-schedule.ts:173-230`
- `packages/contracts/src/workflow-schedule.ts:232-276`

**Recommendation:** write the clock transition table and property-test edits,
retries, timezone boundaries, and enable-disable edges.

### ISM-20: Collection URL synchronization

The hook infers whether an incoming URL is its own write or external navigation
using local state, a seen value, and a 32-entry written history. It also performs
render-phase state synchronization.

Rapid writes and out-of-order router settlement depend on serialization and the
finite history heuristic. There are no focused tests for this protocol.

**Important code:**

- `apps/web/src/hooks/use-collection.ts:27-62`
- `apps/web/src/hooks/use-collection.ts:64-100`

**Recommendation:** extract a pure transition model and test back, forward,
rapid local writes, out-of-order settlement, and history eviction.

### ISM-21: Synced-list polling

**Inferred states:** initial load, idle, refresh pending, queued and waiting,
observed completion, and timed out.

Server syncing, mutation state, a local deadline, `syncedAt`, and polling
interval jointly determine the phase. The waiting record is not explicitly
cleared, and timeout completion can depend on incidental query notifications.

**Important code:**

- `apps/web/src/hooks/use-synced-list.ts:25-63`

**Recommendation:** model waiting and timeout transitions explicitly and add
fake-clock tests.

### ISM-22: OAuth popup completion

The route has a discriminated view, but terminality, popup versus full-page
delivery, opener reachability, message posting, navigation, and the `done` ref
form a separate machine. `done` is set before full-page navigation. If navigation
fails, the page can remain permanently working with no retry.

**Important code:**

- `apps/web/src/routes/oauth.popup-callback.tsx:46-110`
- `apps/web/src/routes/oauth.popup-callback.tsx:112-180`
- `apps/web/src/routes/oauth.popup-callback.tsx:182-228`

**Recommendation:** make delivery and navigation outcomes explicit terminal or
retryable transitions.

### ISM-23: GitHub and OpenGit token caches

Cache presence and expiry imply missing, cached-valid, expiring, minting,
refreshed, and failed states. Concurrent misses are not coalesced, so duplicate
token minting is possible.

**Important code:**

- `packages/forge-github/src/client/auth.ts:64-107`
- `packages/forge-opengit/src/client/auth.ts:56-101`

**Recommendation:** add single-flight minting if concurrency becomes material.

### ISM-24: Per-evaluation signal load promises

Promise presence and settlement encode unloaded, in-flight, fulfilled, and
rejected states. Rejection is sticky for the evaluation, and key collisions
alias otherwise unrelated reads.

**Important code:**

- `packages/sdk/src/forge.ts:88-113`

**Recommendation:** no refactor is needed while sticky failure and evaluation-
scoped caching remain intentional. Document the key uniqueness contract.

## Highest-value next investigations

1. **Failure-inject webhook processing.** Prove or disprove the normalized-event
   loss window before designing a broad refactor.
2. **Write the workflow execution transition table.** Use existing pause and
   resume tests to enumerate legal node and run states before changing storage.
3. **Specify GitCafe authority and action invariants.** Treat receipts,
   generations, revocations, credentials, claims, markers, and queue recovery as
   one security and delivery protocol.
4. **Reproduce save-during-save.** Add a focused test where an edit occurs after
   a commit snapshot is submitted but before it resolves.
5. **Reproduce live revision versus dirty editor state.** Determine whether a
   live agent update can overwrite local graph edits.

## Useful counterexamples

These are genuine stateful systems that are already explicit enough and should
not be counted as implicit findings:

- Mascot transition table: `apps/web/src/components/mascot/machine.ts:3-109`
- Feedback state and reducer: `apps/web/src/components/feedback/feedback-state.ts:1-67`
- Response block builder reducer: `apps/web/src/lib/block-builder.ts:24-180`
- Repository tab reducer: `apps/web/src/components/tabs/repo-tabs-state.ts:18-151`
- Glaze overlay model and session guard: `apps/web/src/lib/glaze/overlay.ts:20-133`
- CLI picker reducer: `apps/cli/src/picker.ts:18-96`

Other rejected candidates include immutable workflow compilation and linting,
redaction projection, pagination loops, guarded fetch pipelines, simple status
display maps, and schema-only enums whose transition owners are listed above.

## Overall assessment

The repository does not have a generic "too many state machines" problem. Most
small UI machines that have received focused work are already explicit reducers
or transition tables. The architectural risk is concentrated in distributed
lifecycles that cross persistence, queues, external providers, and recovery.

The best first move is not to add a state-machine library. It is to write and
test pure transition tables for the five highest-risk protocols, then decide
whether their current representations can enforce those tables. The codebase
already contains good local examples of explicit machines, so the likely path is
typed unions, pure transition functions, guarded writes, and failure-injection
tests rather than a new dependency.
