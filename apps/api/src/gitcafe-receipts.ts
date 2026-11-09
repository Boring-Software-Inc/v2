import { createHash } from "node:crypto";
import {
	GITCAFE_RECEIPT_APP_ID,
	GITCAFE_RECEIPT_MAX_BYTES,
	type GitCafeReceiptConfig,
	gitCafeEventEnvelopeSchema,
	gitCafeReceiptConfigSchema,
	gitCafeReceiptSchema,
} from "@tripwire/contracts";
import { gitCafeLifecycleServices } from "@tripwire/db";
import { verifyGitCafeWebhook } from "@tripwire/forge-gitcafe";
import { generateId } from "@tripwire/utils";
import type { Context } from "hono";
import type { ApiEnv } from "./env.ts";

export function resolveGitCafeReceiptConfig(
	env: Record<string, string | undefined>,
): GitCafeReceiptConfig | null {
	if (env.GITCAFE_WEBHOOK_RECEIPTS_ENABLED !== "true") return null;
	if (env.UNKEY_ENVIRONMENT_SLUG !== "preview")
		throw new Error("GitCafe receipt admission requires preview environment");
	const parsed = gitCafeReceiptConfigSchema.safeParse({
		appId: env.GITCAFE_APP_ID,
		keyVersion: env.GITCAFE_WEBHOOK_KEY_VERSION,
		secret: env.GITCAFE_WEBHOOK_SECRET,
	});
	if (!parsed.success)
		throw new Error("Invalid staging GitCafe receipt configuration");
	return parsed.data;
}

export async function receiveGitCafeReceipt(c: Context<ApiEnv>) {
	const { gitCafeReceipts: config, pool, boss, logger } = c.get("deps");
	if (!config) return c.json({ error: "unknown forge" }, 404);
	const contentType = c.req
		.header("content-type")
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	if (contentType !== "application/json")
		return c.json({ error: "expected application/json" }, 415);
	const deliveryId = c.req.header("x-gitcafe-delivery");
	const eventType = c.req.header("x-gitcafe-event");
	const timestamp = c.req.header("x-gitcafe-timestamp");
	const keyVersion = c.req.header("x-gitcafe-key-version");
	const signature = c.req.header("x-gitcafe-signature");
	if (
		!deliveryId ||
		deliveryId.length > 255 ||
		!eventType ||
		eventType.length > 128 ||
		!timestamp ||
		!keyVersion ||
		!signature
	)
		return c.json({ error: "missing or invalid delivery headers" }, 400);
	const length = c.req.header("content-length");
	if (
		length &&
		(!/^\d+$/.test(length) || Number(length) > GITCAFE_RECEIPT_MAX_BYTES)
	)
		return c.json({ error: "body too large" }, 413);
	const reader = c.req.raw.body?.getReader();
	if (!reader) return c.json({ error: "missing body" }, 400);
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > GITCAFE_RECEIPT_MAX_BYTES) {
				await reader.cancel();
				return c.json({ error: "body too large" }, 413);
			}
			chunks.push(chunk.value);
		}
	} catch {
		return c.json({ error: "invalid body" }, 400);
	} finally {
		reader.releaseLock();
	}
	const body = Buffer.concat(chunks, size);
	if (
		!verifyGitCafeWebhook({
			body,
			timestamp,
			keyVersion,
			signature,
			secrets: new Map([[config.keyVersion, config.secret]]),
			now: Date.now(),
			maxAgeSeconds: 300,
			maxFutureSeconds: 30,
		})
	)
		return c.json({ error: "invalid signature" }, 401);
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
	} catch {
		return c.json({ error: "invalid json" }, 400);
	}
	const envelope = gitCafeEventEnvelopeSchema.safeParse(raw);
	if (!envelope.success || envelope.data.type !== eventType)
		return c.json({ error: "invalid event envelope" }, 400);
	const requestId = generateId();
	const receipt = gitCafeReceiptSchema.parse({
		format: "gitcafe-receipt@1",
		appId: GITCAFE_RECEIPT_APP_ID,
		payload: envelope.data,
		bodyBase64: body.toString("base64"),
		bodySha256: createHash("sha256").update(body).digest("hex"),
		deliveryId,
		keyVersion,
		signedAt: timestamp,
		requestId,
	});
	const result = await gitCafeLifecycleServices.insertGitCafeReceipt(
		pool,
		boss,
		receipt,
	);
	logger.info(
		{
			requestId,
			receiptId: result.receiptId,
			eventType,
			inserted: result.inserted,
		},
		"GitCafe receipt accepted",
	);
	return c.json({ ok: true, duplicate: !result.inserted }, 200);
}
