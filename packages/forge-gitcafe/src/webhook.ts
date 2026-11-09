import { createHmac, timingSafeEqual } from "node:crypto";

export interface GitCafeWebhookVerification {
	body: Uint8Array;
	timestamp: string;
	signature: string;
	keyVersion: string;
	secrets: ReadonlyMap<string, string>;
	now: number;
	maxAgeSeconds: number;
	maxFutureSeconds: number;
}

export function verifyGitCafeWebhook(
	input: GitCafeWebhookVerification,
): boolean {
	if (
		!/^(0|[1-9][0-9]*)$/.test(input.timestamp) ||
		!/^sha256=[0-9a-f]{64}$/.test(input.signature) ||
		!input.keyVersion ||
		!Number.isSafeInteger(input.now) ||
		!Number.isSafeInteger(input.maxAgeSeconds) ||
		input.maxAgeSeconds < 0 ||
		!Number.isSafeInteger(input.maxFutureSeconds) ||
		input.maxFutureSeconds < 0
	)
		return false;
	const timestamp = Number(input.timestamp);
	const now = Math.floor(input.now / 1000);
	if (
		!Number.isSafeInteger(timestamp) ||
		timestamp < now - input.maxAgeSeconds ||
		timestamp > now + input.maxFutureSeconds
	)
		return false;
	const secret = input.secrets.get(input.keyVersion);
	if (!secret) return false;
	const expected = createHmac("sha256", secret)
		.update(`${input.timestamp}.`)
		.update(input.body)
		.digest();
	return timingSafeEqual(
		expected,
		Buffer.from(input.signature.slice(7), "hex"),
	);
}
