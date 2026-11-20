# GitCafe receipt recovery and readiness

This runbook covers GC-1, GC-2 and GC-3. It does not establish which release or database handled the November 20 acceptance deliveries. Those facts require staging access and exact provider delivery IDs.

## Release gate

Record API and worker release IDs, `WORKER_MODE`, receipt enablement, expected app ID, registered queues, Sentry configuration as a boolean, and the database/migration identity before operating on retained receipts. Startup pino records contain the non-secret configuration fields. Compare both services to their deployed source.

Use the existing protected database access to inspect `current_database()` and the migration ledger in `drizzle.__drizzle_migrations`. Verify the full ordered chain, including 0045, 0047, 0049 and 0050-0055. Do not bypass a ledger entry or apply an isolated SQL file to an unknown baseline. Migration 0055 is additive: nullable event settlement, recovery cooldown fields, an operator audit ledger and protection heartbeat records. Legacy applied receipts retain unknown evaluation provenance; null settlement is not evidence that a run existed.

Deploy the worker before enabling the API's heartbeat-dependent readiness. The worker uses the same protection runtime in standard and dedicated modes. Isolated mode supervises and consumes only its GitCafe queues. The runtime explicitly creates its connection queue when using a shared boss. Failure or shutdown of that runtime leaves a shared boss owned by its caller.

The sibling GC-5 change supplies workflow skip reasons and correct issue effects. Integrate it before recovering historical no-run issues. At `buildGitCafeRuntime.executeBound` in `apps/worker/src/gitcafe-runtime.ts`, after successful binding and before constructing `GitCafeActions`, pass the optional `issueEvidence` option returned by `gitCafeActionServices.getGitCafeIssueActionEvidence(db, context.actionId)` for recorded actions. That service returns `GitCafeHydratedIssueEvent | null`; pending checks pass null. This final wiring depends on GC-5's service and option and belongs in the combined integration checkout.

## Receipt-to-effect investigation

Find exact receipt IDs using provider event/delivery IDs, scoped to the installation. Export only identifiers, receipt digest, status and timestamps. Never export `receipt`, event `raw`, action payloads, signing headers or provider bodies to a diagnostic log.

Create a local request JSON with:

- `requestId`: one UUIDv7 generated through `generateId()`; reuse it for a repeated apply;
- `operator` and `reason`: accountable operator identity and the specific recovery reason;
- `retryWithoutRun`: false unless the selected historical no-run path is verified fixed;
- `selection`: `environment: "preview"`, the approved `appId`, immutable `organizationId`, `installationId`, `repositoryId`, and 1-100 explicitly selected `receiptIds`.

Run with the existing staging environment configuration. The default performs a read-only inventory:

```sh
bun scripts/gitcafe-recovery.ts selection.json
```

The plan reports provider event/delivery IDs, receipt hash/status, per-event normalization/processing/quarantine/settlement, bounded queue attempt history, run IDs and action status/remote IDs. Classification distinguishes active work, eligible missing jobs, supported parked receipts, intentional skips, quarantine, completed runs, legacy no-run outcomes, revoked authority, binding mismatch, unsupported types and missing rows. A missing run is reported as missing rather than inferred from a successful queue job.

Verify the selection and deployed fixes. Apply a single canary first:

```sh
bun scripts/gitcafe-recovery.ts selection.json --apply
```

Apply revalidates digest/envelope, app, installation, repository, organization claim, arming and lifecycle authority under the admission lock. It uses original receipt bytes and timestamps. It never re-signs an expired webhook. Historical lifecycle and unknown types remain inert. Live created/retry/active jobs are preserved. A repeated request ID is a no-op; concurrent requests serialize and cannot create a second live evaluation job.

Historical no-run retry also requires `retryWithoutRun: true`, no existing run, and legacy or unsupported-event settlement. Maintainer/self/unarmed/no-matching-workflow/stale/superseded skips are not automatically retried. Existing runs must use committed-surface recovery or the existing explicit refresh/rerun mechanism; this operator entry never resets an existing evaluation.

Hydration and action authority checks run again in the consumer. The dry-run does not make provider reads and therefore cannot certify the current subject/head/version. A changed subject is classified after hydration; inspect its durable settlement. Stop the canary on any ownership or identity invariant failure. Re-run the inventory and verify the run and each provider artifact before applying the remainder. A `dispatched` result proves queued work, not provider success.

## Automatic recovery

Pending receipts and dispatched events recover in locked batches of 100. Created/retry/active jobs are preserved; queue-scoped supervision expires stale jobs. Missing work receives one atomic replacement. Repeated recovery uses a durable 30-second exponential cooldown, capped at one hour, rather than immediately restoring the same poison record. Invalid retained bytes or scheduled data quarantine independently, allowing healthy records behind them to progress.

Recovery SQL uses a 10-second statement timeout and 2-second lock timeout. Protection readiness requires registered consumers and fresh success from both recovery stages. Each iteration has a 20-second reporting deadline. A timed-out operation cannot start an overlapping replacement; a later completed iteration restores readiness. Graceful shutdown and pool cleanup are bounded. Committed runs recover their existing evaluation and intents rather than rerunning rules or AI.

Events store a validated finite settlement: completed with run ID, intentional skip with reason, or quarantine with reason. Retryable preparation/database/queue failures do not complete the event. `applied` on a receipt means all dispatched events settled; outstanding recorded effects remain independently retryable.

## Health and alerts

`/healthz` reports `live` and `ready` separately and returns 503 when protection readiness fails. The API probes PostgreSQL/pg-boss with cached, bounded reads and checks durable protection heartbeat even when the backlog is empty. Public health contains no installation, repository, receipt or run identifiers. Expected disabled mode is explicit.

Configure the existing external health monitor to poll the API and worker every 30 seconds. The API remains able to detect a stopped worker. Thresholds are:

- protection heartbeat older than 90 seconds or absent: unhealthy immediately;
- eligible receipt/event older than 120 seconds: alert after two samples;
- unresolved recorded effect older than 300 seconds: alert after two samples.

Pino emits `gitcafe.backlog.alert` once per failing stage and `gitcafe.backlog.recovered` when that stage recovers. Group by environment, service and stage. IDs belong in diagnostic logs and operator evidence, never grouping keys. A queue-only view is insufficient: a missing job can leave the queue empty while durable work stalls. Parked receipts are counted separately.

Worker logs include receipt transitions, process start/settlement, run commit, bounded failure classes, recovery success/failure and readiness transitions with available correlation IDs. Dedicated consumer failures are captured through the installed Sentry SDK using a bounded error, without nested provider error bodies. Pino stdout export is separate from Sentry exception capture; existing instrument preload and DSN configuration do not prove log transport.

Before release, verify one harmless correlated request and worker failure in the actual stdout/exception destinations. Stop the scratch worker, demonstrate the external monitor alerts an operator, restore it and demonstrate recovery notification. This code does not add an outbound integration or claim an alert was delivered. Missing external monitoring or live credentials remains a deployment gate.

## Rollback

Disable the operator entry and affected evaluation consumers, then return to the previous compatible worker/API release as needed. Keep receipts, runs, actions, audit records and additive migration columns. Keep ingress only while durable admission and external backlog monitoring remain verified. Never delete data/jobs or automatically reverse external effects as rollback. Any compensation requires provider readback and an individually authorized operation.
