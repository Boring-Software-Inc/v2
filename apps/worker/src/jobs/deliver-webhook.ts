import { formatDiscordMessage, type WebhookPayload } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { runServices } from "@tripwire/db";
import { type GuardedFetchDeps, guardedPost } from "@tripwire/utils";
import type { Logger } from "pino";

/**
 * Outbound delivery for webhook + discord action nodes — the async, retriable
 * path (§5.12). Runs on a schedule: picks `recorded` delivery rows, POSTs
 * through the SSRF guard, marks executed on success, leaves recorded to retry
 * on a transient failure, and abandons a row too old to keep trying. The
 * destination url + signing secret live on the row; the guard resolves and
 * re-validates the IP at send time (TOCTOU), never follows a redirect, and
 * discards the response.
 *
 * A failure NEVER logs the url — only the class (blocked-destination, timeout,
 * …). The idempotency key sent to the receiver is the ACTION ROW ID, stable
 * across every retry, so a re-attempt after a network blip dedupes receiver-
 * side (discord ignores it — see docs/webhooks.md).
 */

const GIVE_UP_MS = 60 * 60_000;

export interface DeliverWebhookDeps {
	db: Db;
	logger: Logger;
	/**
	 * Transport injection for the integration test ONLY — threaded straight to
	 * `guardedPost`, so the SSRF guard (IP classification, header building,
	 * signing) still runs for real; only DNS resolution and the socket are
	 * faked. Production omits this and hits the real network. If delivery ever
	 * stopped routing through `guardedPost`, these deps would go unused and the
	 * integration test's capture assertions would fail — that is the point.
	 */
	guardDeps?: GuardedFetchDeps;
}

export interface DeliverResult {
	delivered: number;
	failed: number;
	abandoned: number;
}

export async function deliverWebhooks(
	deps: DeliverWebhookDeps,
	now: number = Date.now(),
): Promise<DeliverResult> {
	const { db, logger } = deps;
	const rows = await runServices.listDeliverableActions(db);
	const result: DeliverResult = { delivered: 0, failed: 0, abandoned: 0 };
	const giveUpBefore = new Date(now - GIVE_UP_MS);

	for (const row of rows) {
		const url = typeof row.payload.url === "string" ? row.payload.url : null;
		const delivery = row.payload.delivery as WebhookPayload | undefined;
		if (!url || !delivery) {
			// Malformed row (no destination or unbuilt payload) — abandon it
			// rather than retry forever.
			await runServices.markActionSuperseded(db, row.id);
			result.abandoned++;
			logger.error(
				{ actionId: row.id, kind: row.kind },
				"delivery row missing url or payload — abandoned",
			);
			continue;
		}

		const body =
			row.kind === "discord" ? formatDiscordMessage(delivery) : delivery;
		const signingSecret =
			row.kind === "webhook" && typeof row.payload.signingSecret === "string"
				? row.payload.signingSecret
				: undefined;

		const sent = await guardedPost(url, body, {
			// Discord ignores idempotency + signature headers; only the raw
			// webhook carries them (delivery id = the stable action row id).
			deliveryId: row.kind === "webhook" ? row.id : undefined,
			signingSecret,
			...deps.guardDeps,
		});

		if (sent.ok) {
			await runServices.markActionExecuted(db, row.id, null);
			result.delivered++;
			logger.info(
				{ actionId: row.id, kind: row.kind, status: sent.status },
				"delivery sent",
			);
			continue;
		}

		// Record the failure class on the row (never the url) so it is visible
		// without worker logs.
		await runServices.recordDeliveryFailure(db, row.id, sent.failure);

		if (row.recordedAt < giveUpBefore) {
			await runServices.markActionSuperseded(db, row.id);
			result.abandoned++;
			logger.error(
				{ actionId: row.id, kind: row.kind, failure: sent.failure },
				"delivery abandoned after retry window",
			);
			continue;
		}

		result.failed++;
		logger.warn(
			{ actionId: row.id, kind: row.kind, failure: sent.failure },
			"delivery failed — will retry",
		);
	}
	return result;
}
