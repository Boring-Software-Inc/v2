import { type IngestForge, ingestForgeSchema } from "@tripwire/contracts";
import { eventServices } from "@tripwire/db";
import { verifyWebhookSignature as verifyGithub } from "@tripwire/forge-github";
import { verifyWebhookSignature as verifyOpenGit } from "@tripwire/forge-opengit";
import { Hono } from "hono";
import type { ApiEnv } from "../env.ts";
import { receiveGitCafeReceipt } from "../gitcafe-receipts.ts";

/**
 * GitHub and OpenGit share raw-body HMAC admission; GitCafe uses its timestamped
 * receipt protocol before this registry. Unknown forges fail before body reads.
 * The registry stays exhaustive for the shared protocol, preventing a new forge
 * from silently inheriting another forge's verifier or headers.
 */

interface ForgeWebhook {
	/** Header carrying the forge's delivery id — the idempotency key (§5.3). */
	deliveryHeader: string;
	/** Header carrying the forge's event name. */
	eventHeader: string;
	/** Signature headers, tried in order; the first present one is used. */
	signatureHeaders: readonly string[];
	/** Constant-time verification of the RAW body. */
	verify(
		event: { body: string; signature: string | null },
		secret: string,
	): boolean;
	/** Per-forge secret. GitHub's rides on deps; others read their own env. */
	secret(depsSecret: string): string;
}

const WEBHOOKS = {
	github: {
		deliveryHeader: "x-github-delivery",
		eventHeader: "x-github-event",
		signatureHeaders: ["x-hub-signature-256"],
		verify: verifyGithub,
		secret: (depsSecret) => depsSecret,
	},
	opengit: {
		deliveryHeader: "x-open-git-delivery",
		eventHeader: "x-open-git-event",
		// Same scheme as GitHub, but verified by open-git's OWN adapter so one
		// forge changing its signing can never silently alter the other's.
		signatureHeaders: ["x-hub-signature-256"],
		verify: verifyOpenGit,
		// TODO(deps): move onto ApiDeps alongside GitHub's once a second
		// non-GitHub forge needs a secret here.
		secret: () => process.env.OPEN_GIT_BOT_WEBHOOK_SECRET ?? "",
	},
} satisfies Record<Exclude<IngestForge, "gitcafe">, ForgeWebhook>;

export const webhooks = new Hono<ApiEnv>().post("/:forge", async (c) => {
	if (c.req.param("forge") === "gitcafe") return receiveGitCafeReceipt(c);
	// Unknown forge ⇒ 404 before the body is touched. No default, no fallthrough.
	const parsed = ingestForgeSchema.safeParse(c.req.param("forge"));
	if (!parsed.success || parsed.data === "gitcafe") {
		return c.json({ error: "unknown forge" }, 404);
	}
	const forge = parsed.data;
	const binding = WEBHOOKS[forge];

	const deliveryId = c.req.header(binding.deliveryHeader);
	const eventName = c.req.header(binding.eventHeader);
	if (!(deliveryId && eventName)) {
		return c.json({ error: "missing delivery headers" }, 400);
	}

	// The RAW body, verbatim. Parsing first and re-stringifying reorders keys and
	// fails every signature.
	const body = await c.req.text();
	const signature =
		binding.signatureHeaders
			.map((header) => c.req.header(header))
			.find((value) => value !== undefined) ?? null;

	const { webhookSecret, pool, boss, logger } = c.get("deps");
	const secret = binding.secret(webhookSecret);
	if (!secret) {
		// An unset secret must NEVER mean "accept everything".
		logger.warn({ forge, deliveryId }, "webhook secret not configured");
		return c.json({ error: "forge not configured" }, 503);
	}
	if (!binding.verify({ body, signature }, secret)) {
		logger.warn({ forge, deliveryId }, "webhook signature rejected");
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
		forge,
	});
	logger.info(
		{ forge, deliveryId, eventName, inserted: result.inserted },
		"webhook accepted",
	);
	return c.json({ ok: true, duplicate: !result.inserted }, 200);
});
