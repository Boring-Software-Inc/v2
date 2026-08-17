import { eventServices } from "@tripwire/db";
import { verifyWebhookSignature } from "@tripwire/forge-github";
import { verifyWebhookSignature as verifyGitlab } from "@tripwire/forge-gitlab";
import { Hono } from "hono";
import type { ApiEnv } from "../env.ts";

/**
 * Webhook ingest (§5.1–5.4). Each forge gets its OWN static route, NOT a
 * `/webhooks/:forge` param. Verification is forge-specific and security-
 * critical, so the routes stay separate and thin: verify → tx(insert + enqueue)
 * → 200. Normalization, matching, and everything downstream is the worker's job.
 *
 * POST /webhooks/github — GitHub HMAC over the body (X-Hub-Signature-256).
 * POST /webhooks/gitlab — GitLab signing token or secret token.
 */
export const webhooks = new Hono<ApiEnv>()
	.post("/github", async (c) => {
		const deliveryId = c.req.header("x-github-delivery");
		const eventName = c.req.header("x-github-event");
		if (!(deliveryId && eventName)) {
			return c.json({ error: "missing delivery headers" }, 400);
		}

		const body = await c.req.text();
		const signature = c.req.header("x-hub-signature-256") ?? null;
		const { webhookSecret, pool, boss, logger } = c.get("deps");

		if (!verifyWebhookSignature({ body, signature }, webhookSecret)) {
			logger.warn({ deliveryId }, "webhook signature rejected");
			return c.json({ error: "invalid signature" }, 401);
		}

		let raw: unknown;
		try {
			raw = JSON.parse(body);
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}

		const result = await eventServices.insertRawEvent(pool, boss, {
			deliveryId,
			rawKind: eventName,
			raw,
			forge: "github",
		});
		logger.info(
			{ deliveryId, eventName, inserted: result.inserted },
			"webhook accepted",
		);
		return c.json({ ok: true, duplicate: !result.inserted }, 200);
	})
	.post("/gitlab", async (c) => {
		// GitLab's delivery id is X-Gitlab-Webhook-UUID. The event name is
		// X-Gitlab-Event (e.g. "Merge Request Hook").
		const deliveryId = c.req.header("x-gitlab-webhook-uuid");
		const eventName = c.req.header("x-gitlab-event");
		if (!(deliveryId && eventName)) {
			return c.json({ error: "missing delivery headers" }, 400);
		}

		const body = await c.req.text();
		// Prefer the signing token (webhook-signature). Fall back to the legacy
		// plain-text secret token (X-Gitlab-Token). The adapter checks both.
		const signature =
			c.req.header("webhook-signature") ??
			c.req.header("x-gitlab-token") ??
			null;
		const { pool, boss, logger } = c.get("deps");
		// TODO: give GitLab its own secret in deps (GITLAB_WEBHOOK_SECRET). The PoC
		// reads it from the environment here.
		const gitlabSecret = process.env.GITLAB_WEBHOOK_SECRET ?? "";

		if (!verifyGitlab({ body, signature }, gitlabSecret)) {
			logger.warn({ deliveryId }, "gitlab webhook signature rejected");
			return c.json({ error: "invalid signature" }, 401);
		}

		let raw: unknown;
		try {
			raw = JSON.parse(body);
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}

		const result = await eventServices.insertRawEvent(pool, boss, {
			deliveryId,
			rawKind: eventName,
			raw,
			forge: "gitlab",
		});
		logger.info(
			{ deliveryId, eventName, inserted: result.inserted },
			"gitlab webhook accepted",
		);
		return c.json({ ok: true, duplicate: !result.inserted }, 200);
	});
