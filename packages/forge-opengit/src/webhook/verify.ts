import { createHmac, timingSafeEqual } from "node:crypto";
import type { RawForgeEvent } from "@tripwire/forge";

/**
 * Constant-time verification of X-Hub-Signature-256 — HMAC SHA-256 of the RAW
 * body with the bot's webhook secret. open-git uses the same header and scheme
 * as GitHub, but this is a deliberate copy rather than an import: adapters are
 * siblings and never import each other (§3), so open-git changing its scheme
 * must not require touching forge-github.
 *
 * Read the raw body. Parsing JSON and re-stringifying reorders keys and fails
 * the signature.
 */
export function verifyWebhookSignature(
	event: Pick<RawForgeEvent, "body" | "signature">,
	secret: string,
): boolean {
	if (!event.signature?.startsWith("sha256=")) {
		return false;
	}
	const expected = createHmac("sha256", secret)
		.update(event.body)
		.digest("hex");
	const provided = event.signature.slice("sha256=".length);
	if (provided.length !== expected.length) {
		return false;
	}
	return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/** Computes the header value — used by tests and fixture replays. */
export function signWebhookBody(body: string, secret: string): string {
	return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
