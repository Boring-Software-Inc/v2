import type { InstallationEvent, RepoScopedEvent } from "@tripwire/contracts";
import type { AiReviewGenerate } from "@tripwire/core";
import type { Db } from "@tripwire/db";
import { eventServices, repoServices } from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import { normalizeWebhook } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { WorkerReads } from "../context.ts";
import { emitPendingCheck, emitPrSurface } from "./pr-surface.ts";
import { runWorkflows } from "./run-workflows.ts";

export interface ProcessEventDeps {
	db: Db;
	pool: Pool;
	logger: Logger;
	/** null ⇒ no forge credentials; rules skip on missing context (§6). */
	reads: WorkerReads | null;
	/** null ⇒ actions recorded but not executed (no credentials). */
	adapter: ForgeAdapter | null;
	/** §8 — null without ANTHROPIC_API_KEY; ai-review skips. */
	makeGenerate: ((event: RepoScopedEvent) => AiReviewGenerate) | null;
	/** Base URL for run deep links. */
	appUrl: string;
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

	let normalized: ReturnType<typeof normalizeWebhook>;
	try {
		normalized = normalizeWebhook(
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

	if ("installation" in normalized) {
		await syncInstallation(db, normalized, logger);
		return;
	}

	/** Lazy repo upsert — covers installs that happened while the tunnel was down. */
	if (
		"changeRequest" in normalized &&
		!(await repoServices.getRepoByFullName(db, normalized.repo.fullName))
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
					private: false,
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
		adapter: deps.adapter,
		logger,
		appUrl: deps.appUrl,
	};
	await emitPendingCheck(surfaceDeps, normalized);

	const result = await runWorkflows(
		{ db, logger, reads: deps.reads, makeGenerate: deps.makeGenerate },
		normalized,
		event.id,
	);
	if (result.runId && result.verdict) {
		await emitPrSurface(surfaceDeps, {
			runId: result.runId,
			verdict: result.verdict,
			event: normalized,
			stats: result.stats,
			degraded: result.degraded,
			pendingActionRows: result.actionRows,
		});
	}
}

async function syncInstallation(
	db: Db,
	event: InstallationEvent,
	logger: Logger,
): Promise<void> {
	const installationId = event.installation.externalId;
	if (event.kind === "installation.deleted") {
		await repoServices.removeInstallation(db, installationId);
	} else if (event.kind === "installation-repositories.removed") {
		await repoServices.syncInstallationRepos(
			db,
			installationId,
			[],
			event.repositories,
		);
	} else {
		await repoServices.syncInstallationRepos(
			db,
			installationId,
			event.repositories,
			[],
		);
	}
	logger.info(
		{ kind: event.kind, installationId, repos: event.repositories.length },
		"installation synced — no run, no surface",
	);
}
