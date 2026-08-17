import { createHmac, timingSafeEqual } from "node:crypto";
import type { RawForgeEvent } from "@tripwire/forge";

/**
 * Verify a GitLab webhook. GitLab supports two schemes. This function accepts
 * both, and the route passes the header value as `signature`:
 *
 *  1. Signing token (preferred): header `webhook-signature: v1,<base64>`.
 *     The value is an HMAC-SHA256 of the raw body with the secret.
 *  2. Secret token (legacy): header `X-Gitlab-Token: <token>` in plain text.
 *
 * The check is constant-time. Reject with 401 at the route.
 */
export function verifyWebhookSignature(
	event: Pick<RawForgeEvent, "body" | "signature">,
	secret: string,
): boolean {
	const signature = event.signature;
	if (!signature) {
		return false;
	}
	// Scheme 1: signing token. Format is `v1,<base64 hmac>`.
	if (signature.startsWith("v1,")) {
		const provided = signature.slice("v1,".length);
		const expected = createHmac("sha256", secret)
			.update(event.body)
			.digest("base64");
		return constantTimeEqual(provided, expected);
	}
	// Scheme 2: legacy secret token. Compare the plain token in constant time.
	return constantTimeEqual(signature, secret);
}

/** Build a signing-token header value. Tests and fixture replays use it. */
export function signWebhookBody(body: string, secret: string): string {
	return `v1,${createHmac("sha256", secret).update(body).digest("base64")}`;
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
