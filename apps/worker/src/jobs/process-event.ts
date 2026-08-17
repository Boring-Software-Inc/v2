import type {
	Forge,
	InstallationEvent,
	NormalizedEvent,
	RepoScopedEvent,
	UsageSource,
} from "@tripwire/contracts";
import type { AiReviewGenerate } from "@tripwire/core";
import type { Db } from "@tripwire/db";
import { eventServices, orgServices, repoServices } from "@tripwire/db";
import { getErrorMessage } from "@tripwire/utils";
import type { Pool } from "pg";
import type { Logger } from "pino";
import { type ForgeRuntime, normalizeFor } from "../forge-runtime.ts";
import { emitPendingCheck, emitPrSurface } from "./pr-surface.ts";
import { refreshBranchSuggestions } from "./refresh-suggestions.ts";
import { runWorkflows } from "./run-workflows.ts";

export interface ProcessEventDeps {
	db: Db;
	pool: Pool;
	logger: Logger;
	/**
	 * Per-forge runtime selection (§4). null ⇒ that forge has no live runtime
	 * (e.g. GitHub App creds absent): reads/actions degrade, rules skip on
	 * missing context, actions record but do not execute — same fail-closed
	 * shape as before, now chosen by `event.forge`.
	 */
	resolveForge: (forge: Forge) => ForgeRuntime | null;
	/** §8 — null without ANTHROPIC_API_KEY; ai-review skips. */
	makeGenerate: ((event: RepoScopedEvent) => AiReviewGenerate) | null;
	/** Base URL for run deep links. */
	appUrl: string;
	/** Derived COGS source, threaded to runWorkflows for best-effort metering. */
	meterSource?: UsageSource;
}

/**
 * §5.5–5.6: parse the raw payload with contracts schemas (production IS a
 * test execution), write the NormalizedEvent + NOTIFY 'events'. Parse failure
 * ⇒ quarantine + fixture candidate + log; raw stays untouched. Steps 5.7–5.13
 * (workflow match → executor → actions → PR surface) attach here as their
 * build steps land.
 */
export async function processEvent(
	deps: ProcessEventDeps,
	job: { eventId: string },
): Promise<void> {
	const { db, pool, logger } = deps;
	const event = await eventServices.getEventById(db, job.eventId);
	if (!event) {
		logger.error({ eventId: job.eventId }, "event not found for job");
		return;
	}
	if (event.normalizedAt || event.quarantined) {
		return;
	}

	let normalized: NormalizedEvent | null;
	try {
		// Normalization is pure and chosen by the stored forge — always available
		// even when that forge's reads/actions runtime is offline.
		normalized = normalizeFor(event.forge)(
			{
				deliveryId: event.deliveryId,
				eventName: event.rawKind,
				body: JSON.stringify(event.raw),
				signature: null,
			},
			event.receivedAt.toISOString(),
		);
	} catch (error) {
		const reason = getErrorMessage(error);
		await eventServices.quarantineEvent(db, event.id, reason);
		logger.warn(
			{ eventId: event.id, deliveryId: event.deliveryId, reason },
			"event quarantined — fixture candidate",
		);
		return;
	}

	if (!normalized) {
		logger.debug(
			{ eventId: event.id, rawKind: event.rawKind },
			"event kind not ingested",
		);
		return;
	}

	await eventServices.markEventNormalized(db, pool, event.id, normalized);
	logger.info(
		{
			eventId: event.id,
			kind: normalized.kind,
			repo: "repo" in normalized ? normalized.repo.fullName : null,
		},
		"event normalized",
	);

	// Pick this forge's runtime ONCE; every read/action below uses it. A null
	// runtime degrades exactly like the old missing-credentials path.
	const runtime = deps.resolveForge(event.forge);
	const adapter = runtime?.adapter ?? null;
	const reads = runtime?.reads ?? null;
	const signalHttp = runtime?.signalHttp ?? null;

	if ("installation" in normalized) {
		await syncInstallation(db, normalized, logger);
		// Seed branch suggestions for freshly added repos, so the builder has
		// them before the first PR arrives.
		if (
			signalHttp &&
			(normalized.kind === "installation.created" ||
				normalized.kind === "installation-repositories.added")
		) {
			for (const added of normalized.repositories) {
				const repo = await repoServices.getRepoByFullName(
					db,
					added.fullName,
					normalized.forge,
				);
				if (repo) {
					await refreshBranchSuggestions(
						db,
						signalHttp,
						repo.id,
						added.fullName,
					);
				}
			}
		}
		return;
	}

	/** Lazy repo upsert — covers installs that happened while the tunnel was down. */
	if (
		"changeRequest" in normalized &&
		!(await repoServices.getRepoByFullName(
			db,
			normalized.repo.fullName,
			normalized.forge,
		))
	) {
		await repoServices.syncInstallationRepos(
			db,
			"",
			[
				{
					externalId:
						normalized.repoExternalId ?? `unknown:${normalized.repo.fullName}`,
					owner: normalized.repo.owner,
					name: normalized.repo.name,
					fullName: normalized.repo.fullName,
					/**
					 * Visibility unknown here (change-request payloads aren't
					 * threaded through) — fail closed as private so the §10 public
					 * run page never opens for a repo installation sync hasn't
					 * confirmed public. The next installation event corrects it.
					 */
					private: true,
				},
			],
			[],
		);
		logger.info(
			{ repo: normalized.repo.fullName },
			"repo lazily upserted (no installation event seen)",
		);
	}

	const surfaceDeps = {
		db,
		adapter: adapter,
		logger,
		appUrl: deps.appUrl,
	};

	const result = await runWorkflows(
		{
			db,
			logger,
			reads: reads,
			signalHttp: signalHttp ?? null,
			makeGenerate: deps.makeGenerate,
			meterSource: deps.meterSource,
			// Pending check only after exemption/match — otherwise an exempt
			// actor leaves `tripwire` stuck in_progress forever (lifecycle E2E
			// hang: waitForVerdict never sees a completed check).
			onBeforeEvaluate: () => emitPendingCheck(surfaceDeps, normalized),
		},
		normalized,
		event.id,
	);
	if (result.runId && result.verdict) {
		await emitPrSurface(surfaceDeps, {
			runId: result.runId,
			verdict: result.verdict,
			event: normalized,
			reasons: result.reasons,
			degraded: result.degraded,
			pendingActionRows: result.actionRows,
		});
	}
	// §9 live activity feed: announce the RESOLVED state (run terminal/paused,
	// or no run at all — exempt / no matching workflow) so the feed row can
	// update in place. Carries the event id; the SSE fan-out re-fetches the row.
	await pool.query("SELECT pg_notify('runs', $1)", [event.id]);

	// Keep branch suggestions fresh: a change request means a push landed, which
	// is when branches move. Off the verdict's critical path (already emitted).
	if (signalHttp && "changeRequest" in normalized) {
		const repo = await repoServices.getRepoByFullName(
			db,
			normalized.repo.fullName,
			normalized.forge,
		);
		if (repo) {
			await refreshBranchSuggestions(
				db,
				signalHttp,
				repo.id,
				normalized.repo.fullName,
			);
		}
	}
}

async function syncInstallation(
	db: Db,
	event: InstallationEvent,
	logger: Logger,
): Promise<void> {
	const installationId = event.installation.externalId;
	if (event.kind === "installation.deleted") {
		await repoServices.removeInstallation(db, "github", installationId);
	} else if (event.kind === "installation-repositories.removed") {
		await repoServices.syncInstallationRepos(
			db,
			installationId,
			[],
			event.repositories,
		);
	} else {
		/**
		 * §2 org resolution — installation→org→repos with ZERO user/session
		 * assumptions. The claim itself is a human act (setup callback with a
		 * signed org state, or the claim screen); the webhook path only reads
		 * an existing claim and records account metadata on it. An unclaimed
		 * install syncs repos with NULL org_id — invisible until claimed,
		 * never auto-attached on a guess (§10).
		 */
		const orgId = await orgServices.getInstallationOrg(db, {
			installationId,
		});
		await repoServices.syncInstallationRepos(
			db,
			installationId,
			event.repositories,
			[],
			orgId,
		);
		await orgServices.recordInstallationAccount(db, {
			installationId,
			accountType: event.installation.accountType,
			accountLogin: event.installation.account,
		});
		if (orgId) {
			logger.info({ installationId, orgId }, "installation resolved to org");
		} else {
			logger.info(
				{ installationId, account: event.installation.account },
				"installation unclaimed — repos synced without org, awaiting claim",
			);
		}
	}
	logger.info(
		{ kind: event.kind, installationId, repos: event.repositories.length },
		"installation synced — no run, no surface",
	);
}
