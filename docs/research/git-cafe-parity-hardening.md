# GitCafe parity hardening implementation specs

Date: 2026-11-20. Status: proposed implementation tasks, no product changes or deployment performed by this document.

## Baseline and authority

The source-of-truth specification is present at `repo_docs/spec.md`; `spec.md` and `docs/spec.md` are absent. Apply it with the later GitCafe, issue moderation, standalone outcomes, Responses, and staging decisions in `DECISIONS.md`, plus current root/scoped agent rules. Historical GitCafe research describes earlier gated slices and is not a current deployment inventory.

Repository inspection used local HEAD `359926cabfdce6f72e98e0cc348796a13a405634` on `codex/dashboard-sidebar-polish` and a freshly fetched `origin/staging` at `6d153f16d93a78bda646b60f6382cc3090cfcf22` (2026-11-20, PR #239). This checkout has substantial unrelated tracked and untracked work. Implement from an isolated checkout of the current staging tip, recheck this baseline, and preserve the existing tree. Backend conclusions below were checked against `origin/staging`, not inferred from the older local branch. A branch SHA does not establish which SHA is deployed.

Inputs read: `AGENTS.md`; API, worker, DB, contracts, forge and web scoped rules; `.claude/rules/ingest.md`, architecture and frontend rules; Tripwire design guidance; the installed antislop core/copy/UI/human/mobile guidance with explicit `during` session mode; before-and-after guidance; `repo_docs/spec.md`; `DECISIONS.md`; `docs/research/git-cafe-foundation.md`, `git-cafe-lifecycle.md`, `git-cafe-staging-setup.md`; and relevant receipt/action findings in `implicit-state-machines.md`.

Live acceptance evidence supplied by the parent, not repeated by this specification task: `C:/Users/grim/.codex/visualizations/2026/11/20/01a1f6f3-3f78-7011-883f-e29953f125bb/gitcafe-acceptance/report.md`. GitCafe issues #5-#9, PR #10 and its push reached `https://staging.api.tripwire.sh/webhooks/gitcafe` with HTTP 200. Activity still ends at Oct 30; no new visible runs or issue/PR effects; PR #10 has no checks, comments or reviews. No API/web/worker Sentry logs were found for the last 24 hours. Response levels 0-4 and outcome previews were exercised, but real output could not be checked. These observations do not prove the contents of the staging DB, its queue, the running worker configuration, or a particular failing SQL statement.

## Release scope

Ship supported GitCafe issue creation and change-request evaluation, existing moderation outcomes, correct provider action targets, existing Responses settings, and redaction through the already approved GitCafe integration. Preserve forge/repository/installation/organization boundaries, immutable receipts, current rule versions, unknown-evidence holds and action reconciliation. Use existing PostgreSQL, pg-boss, pino and installed error reporting. No new dependency is required.

Excluded: another forge, account-age/global reputation substitutes, new rules or classifiers, PR-description matching, signal nodes, public OpenAPI, generic event-bus work, deep observability platform, deployment automation, provider UI reconstruction, automatic customer branch-protection changes, permanent content deletion, broad Responses redesign, and new contributor appeal identity semantics. GitHub-only Pilot and allowlist identity data must not be treated as GitCafe identities. Existing human-review approve/deny is included; a new GitCafe contributor appeal login flow is a separate decision.

## Tasks and ownership

| ID | Priority / owner | Deliverable | Dependencies and file ownership |
| --- | --- | --- | --- |
| GC-1 | P0 / runtime | Proven receipt-to-worker diagnosis and reliable automatic recovery | Owns worker startup/registration and `gitcafe-lifecycle.ts` recovery/settlement. Coordinate these shared files with GC-2 and GC-3. |
| GC-2 | P0 / operations | Bounded pino signals, health, queue lag and actual alert delivery | Can begin instrumentation modules/configuration in parallel; runtime health wiring lands after GC-1. Owns instrument files, API health handler and operational query service. |
| GC-3 | P0 / recovery | Explicit retained-receipt inventory and bounded safe recovery | Design/runbook can run in parallel. Service changes serialize after GC-1 because both touch `gitcafe-lifecycle.ts`. Live recovery waits for GC-1, GC-2 and applicable GC-5 fixes. |
| GC-4 | P0 / acceptance | Repeatable staged live matrix with evidence ledger | Can prepare matrix/capture plumbing immediately; live execution waits for GC-1, GC-2 and GC-5. Redaction signoff depends on GC-7. |
| GC-5 | P0 / moderation | Issue workflow/action target correction and supported standalone policy parity | Can run in parallel with GC-1; owns `run-workflows.ts`, `pr-surface.ts`, `gitcafe-actions.ts` and moderation tests. |
| GC-6 | P1 / Responses | Forge-aware labels and sample preview identity, preserved page geometry | Independent of backend edits. Owns Responses components/models/tests only. Needs independent read-only visual auditor after implementation. |
| GC-7 | P0 / privacy verification | Real output redaction certification and fixes only for demonstrated leaks | Test work can run in parallel with GC-5. Any `pr-surface.ts` fix serializes with GC-5; contracts/projection changes require explicit review. |

Recommended sequence: capture staging boundary facts and deploy GC-1 with GC-2 first; merge GC-5 while GC-6 proceeds independently; run GC-3 once the worker can report its progress; execute GC-4 and GC-7 against that exact release. Recheck staging at every integration point. Do not let several implementers edit the same file concurrently. This map permits parallel ownership; it does not authorize starting product work during this planning task.

## GC-1: Accepted receipt processing and automatic recovery

### Scope and evidence

Restore and prove the existing ingress-to-lifecycle-to-process-event pipeline. Keep signature verification and transactional receipt admission thin. A successful HTTP response means durable admission, not that a run or forge action succeeded.

Verified in staging code:

- `receiveGitCafeReceipt` verifies exact bytes, validates an envelope, then calls `insertGitCafeReceipt`. Receipt insertion and lifecycle enqueue share one transaction. The dedupe key is `(installation_id, event_id)`.
- `startGitCafeProtectionRuntime` is invoked from the standard worker as well as the dedicated protection mode. A missing dedicated `WORKER_MODE` is therefore insufficient to explain the incident on this revision.
- `registerGitCafeLifecycleConsumer(..., true)` dispatches repository receipts. Lifecycle-only/connect modes do not provide equivalent evaluation behavior.
- Recovery already exists: `recoverPendingGitCafeReceipts` and `recoverGitCafeEvents`, plus 30-second queue-scoped supervision. Add reliability to these paths rather than introducing a second scheduler.
- `processEvent` returns `undefined` for many different terminal paths. Its protection consumer then calls `finishGitCafeEvent`. The receipt status `applied` can therefore include a deliberate no-run result and is not proof of enforcement.
- `observeGitCafeQueueHealth` is a sticky boolean. Protection recovery catches and logs errors without feeding that health observer. A successful historical boot does not prove recovery is currently making progress.

Unverified hypotheses: deployed SHA/config differs between API and worker; receipt processing is disabled; lifecycle-only mode parks repository events; queues point at a different database; consumer registration failed; stale authority or credential hydration holds events; pg-boss retries exhausted; deterministic skips or the proven GC-5 guards suppress runs. Do not choose a root cause until receipt/event/job state and release identity locate it.

### Files and symbols

`apps/api/src/gitcafe-receipts.ts`: `resolveGitCafeReceiptConfig`, `receiveGitCafeReceipt`; `apps/worker/src/index.ts`; `gitcafe-protection-worker.ts`: `resolveGitCafeProtectionEnv`, `startGitCafeProtectionRuntime`, `registerGitCafeProtectionQueues`; `gitcafe-lifecycle-consumer.ts`: registration and recovery; `jobs/process-event.ts`: `processEvent`; `packages/db/src/services/gitcafe-lifecycle.ts`: admission, dispatch, recovery, completion; `packages/db/src/schema/events.ts`, `schema/gitcafe-lifecycle.ts`; `packages/contracts/src/gitcafe-receipt.ts`; existing receipt/lifecycle/action integration tests.

### Ordered implementation

1. Record deployed API/worker release IDs, mode, enabled flag, registered queues, expected app ID, DB environment identity and migration ledger, without secrets. Query exact provider event/delivery IDs for #5-#9/#10 through receipt, event, pg-boss job, run and action joins. Record absent rows as absent; avoid payload logging. Verify arming, stable repository ID, claim, workflow trigger and contributor exemption separately.
2. Produce one boundary table identifying the last committed transition for each delivery. Compare runtime configuration to the matching deployed source, not only the latest branch. Repair only the verified deployment/configuration or code failure.
3. Give processing a typed result at the existing boundary: completed with run reference, intentional skip with finite reason, quarantined, or retryable failure. Define intentional skips for unarmed, self, maintainer exemption, no matching workflow, unsupported event and stale subject. Carry this classification into a durable settlement record so an event cannot become unexplained `applied`. Keep evaluation-complete separate from action-delivery-complete; recorded actions remain retryable after the run commits.
4. Reuse atomic enqueue, advisory locks, batches of 100, and scoped supervision. Preserve active/created/retry jobs; recover expired, failed or retained-away work once. Add bounded retry scheduling for repeated recovery cycles so deterministic poison does not continually occupy the oldest batch or monopolize the global connection lock. Quarantine invalid retained data with a bounded reason and fixture reference. Do not mark transient preparation/DB/queue errors complete.
5. Bound recovery and shutdown work. A hung iteration must time out and report failure; healthy later iterations restore readiness. Avoid a second registration/timer when embedded in standard mode. Separate isolated-runtime cleanup from ownership of a shared boss.
6. Preserve committed-run recovery: after a run/audit/action-intent transaction commits, retry restores its surfaces rather than reevaluating rules or calling AI again. Recheck current authority, repository binding and newer run/head ownership before each effect.

### Tests, rollout, observability and rollback

Use real Postgres and real pg-boss tests for crash after receipt commit, after dispatch commit, after normalization, after run commit, and after remote success before acknowledgement. Assert one receipt, expected per-ref events, one live evaluation per event, stable action intents, and no duplicate provider effect. Exercise standard and dedicated modes, two replicas, recovery outage/return, removed jobs, failed/expired jobs, stale active-job expiry, >100 pending records, and a poison record before healthy records. Include signed captured issue and PR fixtures with non-exempt contributors. Existing normalization-only tests are insufficient.

If durable settlement/attempt fields require schema changes, use an additive migration with nullable legacy state, contracts validated on write, and readers before writers. Do not reinterpret legacy `applied` as proof of a run. Check the migration ledger for 0045/0047/0049 and the current pending chain; historical rollout cautions do not authorize blindly applying or manually bypassing it. Emit GC-2 correlation and recovery counts at each boundary.

Roll back code/config to the previous compatible staging release and disable evaluation consumers if needed; retain receipts and additive columns. Ingress may remain available only while durable admission and backlog alerts work. Do not delete jobs, receipts, runs or actions to simulate rollback. Completed external actions require an individually verified compensating action, not automatic reversal.

Done when: each supplied delivery has a documented terminal classification or actionable retry; a fresh armed external-contributor PR creates a visible run and intended provider artifacts within 60 seconds in the controlled test; a controlled worker/DB outage recovers without manual row edits or duplicate effects; recovery starvation and stale-green health tests pass; no general-forge backlog is consumed by isolated mode. These are release acceptance targets, not claims about current performance.

## GC-2: Operational visibility, health and backlog alerts

### Scope and evidence

Provide the smallest operational surface that detects accepted work without progress. Remain within pino plus existing error reporting and deployment monitoring. No metrics warehouse, tracing expansion, new SaaS, general dashboard or observability dependency.

Verified: API `/healthz` currently returns `{ok:true}` without a DB/queue readiness check. Standard worker health reports GitCafe disabled/live/degraded using its runtime boolean. That boolean does not measure lag, consumer heartbeat or durable backlog. `captureJobFailures` wraps standard consumers; dedicated GitCafe consumers directly register `boss.work`. Existing Sentry instrument files configure exceptions/traces and disable queue payload collection; they do not explicitly configure pino log export. The supplied absence of Sentry logs does not prove no pino stdout logs exist or that DSNs are absent.

Files: `apps/api/src/index.ts`, `gitcafe-receipts.ts`, `apps/api/instrument.ts`; `apps/worker/instrument.ts`, `src/capture-job-failures.ts`, `gitcafe-lifecycle-consumer.ts`, `gitcafe-protection-worker.ts`, `index.ts`; `apps/web/instrument.server.mjs`; `packages/db/src/services/gitcafe-lifecycle.ts` and a narrowly named operational service in its existing directory if needed; existing `railway.json` and deployment smoke scripts. Do not edit unrelated uncommitted web health work in this checkout.

### Ordered implementation

1. Prove what telemetry currently reaches stdout and Sentry for one request and one worker failure on the deployed release. Verify instrumentation preload commands, environment/release tags, DSN presence as a boolean, buffering/flush, and the actual collection destination. Report missing log transport separately from missing exception capture.
2. Establish a finite pino event vocabulary: receipt accepted/duplicate, receipt dispatched/parked/malformed, process started/retrying/settled, run committed, action recorded/reconciled/executed/held, recovery tick success/failure and health transition. Include service, release, mode, forge, queue, request ID, receipt ID, event ID, job ID, run ID and action ID where available; duration, attempt count and finite reason. Never include bodies, matched values, paths, tokens, signing headers, AI prompts/traces or secrets. Keep high-cardinality IDs in logs, not alert grouping keys.
3. Use a DB service for a bounded summary of pending/dispatched receipt count and oldest age; unprocessed events with and without live jobs; failed/active/created/retry queue count and oldest age; oldest unresolved recorded action; most recent successful consumer/recovery progress. A queue can be empty while a receipt stalls, so measure durable state too. Count deliberate parked unsupported events separately from eligible work.
4. Extend existing `/healthz` to report liveness and readiness separately in its response. Set its existing healthcheck status to 503 for an enabled runtime lacking registered consumers, bounded DB/queue probes, or a fresh successful recovery heartbeat. Expected disabled mode is explicit; an environment that advertises GitCafe receipts but has no evaluation runtime must not appear ready for protection. Keep dependency probes cached and timeout-bound. Do not expose sensitive installation/repository identifiers publicly.
5. Initial operational thresholds: 30-second sampling, recovery heartbeat stale after 90 seconds, eligible receipt/event with no progress older than 120 seconds alerts after two samples, unresolved effect older than 300 seconds alerts. Record the age and stage, not only the count. Deduplicate by environment/service/stage and send a recovery notification when healthy. Tune these documented defaults only with measured staging evidence. Distinguish intentionally disabled/parked from eligible stalled work.
6. Configure the existing approved monitoring destination to watch health and the pino-derived backlog signal. Prove an alert reaches an operator when the worker is stopped; a stopped worker cannot alert about itself. If the existing destination cannot detect missing heartbeat, record that deployment gate and use an existing external health monitor rather than building deployment automation. Do not add an outbound messaging integration without the required explicit authorization.
7. Give operators one concise investigation query/runbook: release and mode, receipt-to-run chain, oldest age, current failure class and recovery owner. Keep logging usable even when Sentry log collection is unavailable.

### Tests and release criteria

Test health against healthy/absent consumers, DB unavailable, queue error then recovery, hanging probe, stale timer, worker stopped and empty backlog. Inject one unique harmless error and receipt correlation marker and verify it in the intended collection destination. Verify a backlog alert and its recovery notification with actual receipt IDs in supporting operator evidence, not in the public health body. Test redaction against nested Error objects and provider response bodies.

No migration is required for process-local health. If durable heartbeat/settlement storage is required for cross-process detection, reuse GC-1's additive contract/schema change with one migration owner. Avoid health queries scanning immutable bodies; inspect query plans and add only justified indexes. Roll out collection and health first, then alerts and thresholds. Rollback disables new alert rules or restores prior health handling while retaining pino records and any additive data. Missing telemetry must remain a failed release gate, not become green by removing the check.

Done when: a delivery can be followed from admission to outcome without raw payload access; a stopped or hung consumer with accepted receipts is detected and an operator receives a real alert within five minutes; health returns ready only after actual progress resumes; every deployed API/worker service has verified searchable bounded logs and release identity. Web has a verified collection smoke signal if its telemetry is part of the deployment claim. No new observability platform is introduced.

## GC-3: Retained-event inventory and explicit recovery

### Scope and evidence

Recover the bounded acceptance corpus and document repeatable operator recovery. Do not bulk replay all historical events or silently reevaluate already settled contributions.

Verified: dispatch only accepts `status='pending'`; parked receipts remain inert by design. Duplicate admission returns the prior receipt without requeueing. Automatic receipt recovery only scans pending rows; event recovery scans dispatched unprocessed events. Provider redelivery cannot, by itself, unpark a previously parked receipt. `finishGitCafeEvent` may already have completed a normalized issue with no run because of GC-5. Both cases need explicit classification, not a blanket `UPDATE status='pending'`.

Files: `packages/db/src/services/gitcafe-lifecycle.ts` existing dispatch/recovery/settlement; contracts receipt/job schemas; `apps/worker/src/jobs/process-event.ts` and `pr-surface.ts` existing committed-run recovery; an operator entry under existing `scripts/` if necessary; `docs/research/git-cafe-lifecycle.md` and this document. Existing `apps/worker/src/jobs/replay.ts` is verdict replay, not a signed-receipt recovery tool. Do not repurpose it to perform forge writes implicitly.

### Ordered implementation

1. Inventory exact installation/event/delivery IDs, receipt hashes/status/timestamps, dispatch fanout, normalized/processed/quarantine state, live jobs, runs and action receipts for #5-#9/#10. Export only redacted metadata. Preserve original raw bytes.
2. Add an operator dry-run plan scoped by environment, immutable installation/repository IDs and explicit receipt/event IDs. It reports eligible, pending/active already, supported-but-parked, deliberately skipped, quarantined, completed with run, completed without run, changed subject, and revoked authority. Default is read-only. Applying requires the explicit plan selection and reports one per-item result.
3. Allow supported-but-parked recovery only for individually selected repository event receipts that were authenticated on admission, still pass stored-byte digest/envelope checks, and match the expected app/claim/repository. Keep lifecycle parked/malformed/unknown types inert. A new supported type does not authorize historical autoactivation. Record operator, reason, original state, IDs, time and recovery request ID in durable audit data; do not rewrite receipt payload or signing timestamp.
4. Reuse the dispatch transaction and dedupe keys for missing event fanout. Pending/dispatched records use normal recovery. For a processed-without-run event affected by a now-fixed deterministic guard, require explicit audited retry eligibility and prove no committed evaluation exists. Existing completed runs only recover their missing surfaces or use the existing explicit rerun path; never create an accidental second evaluation.
5. Serialize recovery with current admission/authority locks. Revalidate current arming, org/repository binding, lifecycle generation and subject/head/version through existing hydration before effects. Expired webhook timestamps are not freshly accepted; trusted retained receipts use admission provenance. Never re-sign bytes locally to impersonate a new provider delivery.
6. Execute a small canary, then the selected remainder; stop at first invariant violation. Reconcile each selected item into one final reason, run link or action link. If #5-#9 are now stale, retain that result and create fresh acceptance cases. Historical processing observes current supported configuration; original level settings are not reconstructed from memory.

### Tests, rollout and done when

Real DB tests: dry-run has zero writes; duplicate and concurrent plans create one job; active work is preserved; digest mismatch, wrong org/repo/app, revoked installation and changed subject are refused; genuine old parked supported receipt can recover; unknown/malformed receipts stay inert; processed-no-run recovery does not duplicate committed runs; retry after remote success reconciles existing provider objects. Capture real failure payloads through `/capture-fixture` and validate independently with `/validate-fixture`.

Land additive audited recovery support after GC-1 and GC-5, before operating it. Store recovery metadata separately from immutable receipt bytes; if a new audit shape is necessary, put its schema in contracts and use an additive migration. Stop/disable the operator entry to roll back; preserve the ledger and queued work, and use normal consumer controls to halt effects. No rollback deletes provenance.

Done when: every original acceptance delivery is accounted for by exact ID and observable state; eligible retained work recovers without manual SQL mutation or duplicates; refused work has a reason; a second apply is a no-op; the operator can repeat the dry-run and reconcile results. Provider redelivery is tested separately and never used as evidence of successful recovery without DB/run/readback proof.

## GC-4: Repeatable live acceptance and release evidence

### Scope, evidence and files

Certify existing approved behaviors on the sacrificial staging installation. The supplied report is a failed baseline, not proof that rules or redaction are broken. Use it as the before evidence for the incident. PR #10 is `https://git.cafe/boring/scratch/pull/10`, original head `586ab3645cf0c78dffc48998b36a93bb52d60df8`, files `qa/redaction-a.txt` and `qa/redaction-b.txt`. Re-read the live head before using it.

Extend existing `scripts/e2e/` harness/axes and capture procedures where they can represent GitCafe accurately. Inspect their GitHub assumptions first; keep provider-specific transport in `packages/forge-gitcafe`, and shared durable services in DB. Update existing research/runbook docs. No new product route or test-only production endpoint. Use `/capture-fixture` and its separate validator for newly captured provider payloads; do not invent fixtures from documentation.

### Ordered implementation and matrix

1. Freeze the tested release IDs and capture pre-test arming, rule/workflow versions, Responses config, effective policy and actor roles. Identify a real external non-exempt contributor; a maintainer-authored test alone is invalid. Record all changes needed for this scratch test and restore them afterward.
2. For each case, record test ID, time, actor role, stable repo/install IDs, event/delivery/receipt IDs, HTTP result, job attempts, normalized/settlement reason, run/steps/verdict, action IDs/status, provider readback URLs/IDs, effective redaction policy and evidence media. A case fails if its receipt is accepted but unaccounted for.

| Case | Action | Required result |
| --- | --- | --- |
| External issue, pass/fail | Fresh `issue.created`, matching enabled issue workflow | One issue run with evidence; configured comment/close only on that issue; no PR check/review. |
| External PR, pass/fail | Fresh `pull.created` with multi-file rule evidence | One joined run, expected check/review/comment according to configuration, correct SHA and verdict agreement. |
| Outcome set | Block, Ask author to fix, Human review, Note only, Close on separate controlled contributions | Exact existing outcome contract. Human review approve/deny resumes the same run and amends its owned effects. Destructive issue actions are held on missing evidence. |
| PR update | New head then pass/block transition | Check bound to the new SHA, owned comment updated, stale review cleaned up before a clearance is reported. |
| Rerun | Dashboard rerun and provider `check.rerequested` where supported | Explicit new rerun record under current config, proper cooldown/authorization, no duplicate thread spam. |
| Exempt/self/unarmed | Maintainer, bot/self, then unarmed repository | Observable intentional skip with no unwanted effects; strict allowlist semantics remain scoped to supported identity capabilities. |
| Duplicate | Re-deliver the same provider event/different delivery attempt | One semantic receipt and expected event fanout; no duplicate evaluation/effect. |
| Recovery | Stop worker, accept a fresh receipt, restore worker; controlled transient provider failure | Backlog alert, then automatic progress and readback without manual DB writes or duplicate effects. |
| Authority loss | Scratch-only pause/removal/revocation during retry | Effects held, generation respected; no regrant or autoarming by receipt replay. |
| Redaction | Levels 0-4 for issue/PR, each selected public surface and viewer | GC-7 ledger and no hidden data on emitted artifacts or public responses. |
| Isolation/regression | Same-name records in another forge/tenant; existing GitHub smoke | No cross-forge effects/history; established GitHub path still works. |

3. Apply each redaction level, save and verify the effective persisted config, then create and finish that case before changing the level. Old queued #5-#9 cannot establish the original level behavior after settings changed. Retain original delivery evidence as recovery cases and create fresh per-level subjects for privacy certification.
4. Record unsupported provider capability as a tested unavailable state with a reason. Do not emulate GitHub account history or infer required-check enforcement from check creation. If required-check enforcement is part of the release claim, a maintainer must configure the scratch repo and demonstrate the merge gate separately; Tripwire does not change customer branch protection.
5. Run focused integration suites and all mandatory checks on the final staging commit, then execute live cases on that same release. Publish updated report and provider/UI media next to findings; never capture secrets or private payloads in media. Re-read provider objects instead of treating mutation request issuance as success.

No migration belongs to the acceptance task. Log correlation comes from GC-2. Abort and restore scratch config on a failed canary; leave evidence and audit rows intact. Rollback of the tested release belongs to its implementation owner. Tests themselves may create expected sacrificial provider objects but must not delete real contributions.

Done when: every applicable matrix row has reproducible steps, exact release/config identity and both Tripwire and provider evidence; all original deliveries have a recovery classification; no accepted eligible receipt stalls; no unexplained skipped test is counted as pass. GitCafe remains staging-qualified until separately approved production activation.

## GC-5: Correct issue moderation and supported policy parity

### Scope and verified gaps

Enable the already-approved GitCafe issue-created evaluation path through real runs and issue-target actions; ensure existing supported PR standalone outcomes do not silently fall back to different semantics. This is not a new rule catalog, classifier or new appeal system.

Verified in `origin/staging`:

1. `gitCafeIssueEventSchema`, `hydrateGitCafeIssueEvent` and `normalizeGitCafeIssueEvent` admit/hydrate/project `issue.created` into `issue.opened`.
2. `runWorkflowsInner` returns `none` for every issue when `event.forge !== 'github'`, even after successful GitCafe hydration. A normalized issue is therefore not a proof of an issue run.
3. Its `subject` calculation is also GitHub-only. GitCafe PRs do not enter the newer standalone moderation policy path; issues cannot enter it either. Existing workflow actions may work, but that does not prove configured standalone Warn/Human review/Block/Close parity.
4. `getGitCafeActionBinding` chooses issue for comment/thread variants, then defaults other normalized events to `change-request`. An `issue.opened` action would target a pull unless explicitly classified. Removing only the workflow guard would expose this second defect.
5. The staging `signed issue.created reaches the worker as issue moderation evidence` test asserts normalized shape, not a run or action, and uses a maintainer fixture. It cannot catch these gaps.
6. GitHub-only contributor allowlist/Pilot/appeal services intentionally use GitHub identity evidence. They cannot be enabled by dropping all forge guards indiscriminately.

Files/symbols: `apps/worker/src/jobs/run-workflows.ts`: `runWorkflowsInner`, `readAllowlistStatus`, standalone outcome handling; `jobs/standalone-moderation.ts`; `jobs/pr-surface.ts`: `emitPrSurface`, `emitThreadActions`, `recoverGitCafeRunSurface`; `jobs/resume-run.ts`; `packages/db/src/services/gitcafe-actions.ts`: `getGitCafeActionBinding`; `services/runs.ts`: `persistRunEvaluation`, phase and surface-intent recording; `apps/worker/src/gitcafe-action.integration.test.ts`, `rule-outcomes.integration.test.ts`; staging issue fixtures/contracts/events implementations. Inspect capability definitions in contracts and sdk before changing supported-rule admission.

### Ordered implementation

1. Add a failing end-to-end integration case from a real captured issue payload with explicit non-exempt actor data: signed admission through real queues, normalization, enabled issue workflow, run/steps/action intent, provider readback. Assert issue ID/number/repository/installation and author evidence throughout. Use controlled DB role state separately from captured provider fixtures.
2. Replace GitHub-name checks only where a supported GitCafe capability and stable repository/installation binding establish equivalent authority. Preserve mismatched IDs, inactive authority, removed repo, no claim, unarmed and missing-evidence refusals. Keep issue-edited/reopened triggers outside this slice.
3. Classify issue subjects explicitly in both persisted run metadata and action bindings. For issue #N, assert every effect hits `/issues/N`; never `/pulls/N`. Issue effects must not require a head SHA or emit PR checks/reviews. Retain version preconditions, current-author verification and action authority before writes.
4. Use the existing standalone policy evaluator for GitCafe-supported rules and subjects, including issue opt-in, warn default and strongest-outcome aggregation. Keep unsupported GitHub identity rules unavailable with explicit capability reasons. Do not reinterpret actor IDs as GitHub account IDs or derive fake reputation. If policy settings currently advertise more than the supported GitCafe contract, scope the behavior explicitly and record the mismatch before enabling it.
5. Use committed evaluation phases and durable action intents for issue Responses as well as PRs. Audit the issue branch's use of generic `recordActions` against GitCafe phase fencing so resume/retry cannot emit an obsolete verdict comment. Preserve current redaction and contribution exemption rules; current hydration must hold comment/close when enforcing evidence cannot be verified.
6. Verify human-review resume, action sweeper recovery, duplicate delivery, closed/stale subjects and same-number issue/PR isolation. Existing GitCafe reopen/unlock code is not proof that contributor appeal authentication works; leave new contributor appeal flow unavailable and do not emit an unusable appeal link for a GitCafe subject. A capability-aware link fix is allowed where this task newly exposes Responses; no new auth flow.

### Tests, rollout and done when

Real Postgres/pg-boss coverage must assert run, steps, subject kind, intent and correct remote endpoint for external issue pass/fail and each supported issue outcome, plus unknown contributor permission holds. Include a same-number PR trap, foreign repo/install/tenant trap, maintainer/self exemption, unarmed state, transient failure, timeout after successful write, moderation resume and newer-phase supersession. Test supported standalone PR outcomes and preserved authored-workflow semantics. Existing GitHub outcome tests remain green; Pilot/allowlist must not start reading GitCafe IDs. Snapshot issue and PR output separately.

Prefer no schema change; reuse existing subject metadata and phases. If new capability contracts are required, review them before callers change. Roll out behind the existing staging integration gate, starting with an explicit harmless comment workflow and external actor; only then test scratch close. Telemetry must state rule match, subject, skip/held reason and action result without evidence text. Roll back by disabling the affected scratch workflows/outcomes and reverting compatible code; retain audit data and reconcile already posted artifacts individually.

Done when: an armed GitCafe issue with a matching enabled supported workflow persists one correct issue run and expected comment/close on that issue; unknown evidence holds destructive effects; no issue path targets pulls or checks; supported PR standalone outcomes match their configured policy; retry/resume preserves intent ownership; GitHub behavior is unchanged. Each original issue's no-run state is either recovered or explicitly classified by GC-3.

## GC-6: Forge-aware Responses copy and sample identity

### Scope and evidence

Copy/identity polish on `/$org/$repo/responses`, including the tested `/test/scratch/responses`. Preserve the current approved Responses layout, sorting, editing, scroll, save/discard, redaction controls and interactions. No page redesign, token, primitive or provider-browser reconstruction.

Verified labels include `Select a block to edit its GitHub output`, `Publish these response blocks on GitHub`, and region `GitHub response preview`. Additional hardcoded references occur in review labels/help, skeleton accessible text, mobile blocker, stage/check chrome, `sample-run.ts` (`forge:'github'`) and sample models. `ResponsesPage` already queries the repo but does not pass its forge into `ResponsesView`/`ResponseBuilder`. Staging has newer Responses work than this local branch; implement from its current version.

Files: `apps/web/src/components/responses/responses-page.tsx`, `blocks/response-builder.tsx`, `response-editor.tsx`, `responses-preview.tsx`, `response-github-stage.tsx`, `responses-mobile-blocker.tsx`, `responses-page-skeleton.tsx`, `redaction-model.ts`, `responses-model.ts`, `sample-run.ts`, relevant existing tests and any proven shared forge display helper. Check `@tripwire/utils` and existing forge metadata before writing another helper. No change to `packages/ui` is expected.

### Ordered implementation

1. Read scoped UI rules and before/after skill. Announce required visual evidence, then capture the existing GitCafe and GitHub Responses routes before editing. References are those captures and the current staged behavior. Both surfaces are `preserve`; the only intentional delta is accurate forge naming/sample identity and wrapping caused by that text.
2. Thread the resolved repo forge through page-owned product components and preview data. Unknown/loading context uses neutral text, not a GitHub default. Keep persisted ResponseConfig and backend save payloads unchanged.
3. Use exact neutral replacements where possible: `Select a block to edit its output.` and `Publish these response blocks.` Use `<forge name> response preview`, `<forge name> review` and matching loading text where provider identity matters. Mobile copy: `Use a desktop to build and preview responses.` Review help uses `This review requests changes...`. Do not rename the page or introduce new settings.
4. Remove GitHub-only visible branding/host/source claims from a GitCafe sample using the existing stage geometry; label generic sample chrome as sample output where it cannot faithfully represent GitCafe. Do not claim the preview reproduces the provider UI. Sample run forge and links must match selected forge or remain inert clearly marked sample links. GitHub context retains its established provider names and capabilities. Support for provider review/check tabs follows existing capabilities rather than their display names.
5. Add regression assertions for both forges, loading neutral state, desktop preview, mobile blocker, skeleton/accessibility names and every preview outcome. Check rendered strings and sample data; do not rely on a blind repository-wide replacement.
6. Capture matching after evidence and publish it through the skill's marked PR block; inspect the rendered PR. A fresh read-only audit agent compares references and supplies the root rubric score/evidence. Fix and repeat until no blocker/category below 4 and total at least 95. Intentional copy changes are the declared scope; seek review for any additional visual delta.

### Verification, rollout and done when

Required states: GitCafe/GitHub; light/dark; 1440x900 desktop, 1024x768 transition and 390x844 mobile blocker; loading; editor with block selected/unselected; posting on/off; all five outcomes; level 0/4 and inherited policy; unsaved save/discard/error/read-only states; long repo/owner names and wrapped labels. Preserve tab order, keyboard sorting/editing, focus, overlay behavior and reduced motion. No empty-state redesign; existing empty/error states stay baseline. Native semantics, behavior primitives and styled controls stay in their current layers; forge context belongs to product components/models.

Run existing Responses tests and web typecheck/build. No migration or operational telemetry change; verify no altered save payload or extra fetch. Rollback is the component-only revert, leaving stored configs intact. Done when GitCafe output has no GitHub-specific destination/identity claim, GitHub remains correct, previews use the resolved forge, geometry/interaction parity and required visual media/audit pass, and the evidence block is verified on the rendered PR. Planning this task does not claim a rendered implementation already exists.

## GC-7: Redaction parity certification

### Scope and evidence

Prove the current policy on actual GitCafe issue/PR output and run views; repair only a demonstrated projection or publication gap. No change to redaction levels, rule semantics, prompts or the Responses design. The absence of runs blocked verification; no data leak has been established by this investigation.

Relevant existing path: `responseServices.getRedactionPolicy` resolves repo inheritance; `planSurfaces`, `redactionLevelFor`, `redactCommentReasons` and rule public projections govern output; `emitPrSurface` builds check/review/comment content; action operations freeze outbound bodies. Issue comments currently rely on the GC-5 path. Preview sample output is not proof of API redaction.

Files/symbols: `packages/contracts/src/redaction.ts` and existing response/block rendering contracts/tests; `packages/db/src/services/responses.ts`; `apps/worker/src/jobs/comment-reasons.ts`, `run-issues.ts`, `pr-surface.ts`, `run-workflows.ts` (`withPublicProjection`); `packages/db/src/services/gitcafe-actions.ts`; `packages/forge-gitcafe/src/actions.ts`; existing GitCafe action tests; `apps/web/src/lib/runs.functions.ts` and run loading/projection services as inspection anchors. Read applicable scoped rules before any eventual change.

### Ordered implementation

1. Define a real multi-file source corpus with distinguishable matched values and paths, captured through sanctioned fixture procedures. Use a supported rule that actually emits those evidence fields. Add real AI review evidence only if the configured rule is enabled and runtime produces it; do not fabricate a live AI trace. If no issue-capable rule emits a particular field, record it as structurally absent and test that field on the PR case.
2. For each selected surface and effective level, execute a fresh settled case and store a redacted evidence ledger. Expected cumulative behavior: level 0 hides nothing; level 1 hides matched values; level 2 also hides paths; level 3 also hides AI trace; level 4 also hides AI summary. Verify actual `redactionHides`/block lens semantics for rule names, reasons, links and content not in this list; do not add policy rules by inference.
3. Inspect raw provider comment/review/check bodies and details links, public run server-function responses and page DOM as outsider and authorized member according to existing access contracts. Source may retain private evidence for authorized audit; public JSON must not leak it behind hidden CSS. Verify repo override and org inheritance, unselected surfaces, and private-repo access. Scope any outbound webhook check to already configured approved test destinations.
4. Test initial publish, human-review resume, explicit rerun, response refresh and timeout/retry after operation preparation. Retries must reconcile immutable dispatched bodies; changing policy must use the existing explicit surface refresh/amendment flow rather than silently modifying an in-flight command. Check that a later stricter policy is reflected by refreshed owned artifacts before claiming the refresh complete. Record any retained old output limitation explicitly.
5. If a leak is proven, add a regression at the shared projection/renderer or GitCafe intent preparation boundary that failed. Keep one redaction implementation; do not patch preview strings separately to conceal a worker leak. Verify the GitHub equivalent and historic run readability. Coordinate edits to `pr-surface.ts` with GC-5.

### Tests, rollout and done when

Add table-driven contract tests for levels/surfaces and real-DB integration tests that compare stored public projections and exact outbound operation bodies, including issue/PR subject paths, inherited policy and replay after an ambiguous mutation. Live GC-4 cases verify provider readback, run access and media. Keep canary values out of operator logs; test nested structured fields, Markdown links and URLs as well as text.

No migration for verification-only work. A changed public projection is a reviewed boundary contract; preserve raw audit evidence and historical policy semantics. For an actual leak, stop publishing affected surfaces through existing configuration while the smallest fix is validated; rolling back to leaking output is not a valid privacy rollback. Do not delete receipt/evidence rows. Observability reports surface/level/revision and action result, never hidden content.

Done when: level/surface/viewer cases have actual output evidence with forbidden canaries absent at the required levels; stored private evidence remains available only through authorized paths; issue/PR outputs, check/review/comment and public run response agree with effective policy; retry/refresh do not duplicate effects or disclose stale sensitive bodies without a documented remediation; no preview-only result is presented as end-to-end proof.

## Common implementation and delivery gates

For each implementation slice run Biome, workspace typecheck, `scripts/check-boundaries.ts`, and `bun test`, plus relevant bundles/web build and focused integration suites. Use native WSL Bun, verify the repository's pinned `bun@1.4.4`, and run from the specified isolated checkout. Do not confuse root `bun run test` (interactive live harness) with `bun test` (suite). All fixture additions use the capture/validate pair. Schema changes live in contracts and are validated on write. New IDs come from `generateId()`.

No tests, builds, migrations, live actions, new deployment, production flags, PRs or merges were performed by the preparation of these specifications. Each owner must replace proposed criteria with captured results at implementation time. Overall release remains blocked until GC-1 through GC-5 and GC-7 pass, and GC-6's accurate copy and visual evidence are complete. A successful ingress response or green boot health alone does not satisfy the release gate.

