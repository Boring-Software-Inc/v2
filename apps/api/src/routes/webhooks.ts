import { eventServices } from "@tripwire/db";
import { verifyWebhookSignature } from "@tripwire/forge-github";
import { Hono } from "hono";
import type { ApiEnv } from "../env.ts";

/**
 * Webhook ingest (§5.1–5.4). Each forge gets its OWN static route, NOT a
 * `/webhooks/:forge` param.
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
	});
