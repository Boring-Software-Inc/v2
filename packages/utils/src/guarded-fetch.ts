import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The egress security boundary for outbound POSTs to USER-CONTROLLED URLs
 * (workflow webhook + Discord action nodes). Deny-by-default: https only, no
 * redirects, no private/reserved destinations, bounded time and size, response
 * body discarded. This is the SSRF guard — its test suite is the proof it
 * works, not the happy path.
 *
 * The critical property is TOCTOU-safety: the destination IP is resolved and
 * classified immediately before the request, so a hostname that resolved to a
 * public address at config-save time cannot be re-pointed at 169.254.169.254
 * before delivery. A redirect is a failure, never a hop — that closes the
 * DNS-rebinding path a post-redirect re-check would leave open.
 */

const TIMEOUT_MS = 10_000;
const DNS_TIMEOUT_MS = 5_000;
const MAX_BYTES = 64 * 1024;
/** Cap the OUTBOUND body too — a pathological config can't emit a huge POST. */
const MAX_REQUEST_BYTES = 256 * 1024;

/** Why a destination or delivery was refused. Never carries the URL. */
export type GuardFailure =
	| "not-https"
	| "invalid-url"
	| "unresolvable-host"
	| "blocked-destination"
	| "body-too-large"
	| "redirected"
	| "timeout"
	| "http-error"
	| "network-error";

export type GuardedFetchResult =
	| { ok: true; status: number }
	| { ok: false; failure: GuardFailure; status?: number };

/** Parse "a.b.c.d" into four octets, or null if not a dotted-quad. */
function parseIpv4(ip: string): [number, number, number, number] | null {
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return null;
	}
	const nums = parts.map((p) => Number(p));
	if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return null;
	}
	return nums as [number, number, number, number];
}

/**
 * True if an IPv4 address is loopback, private, link-local (incl. the
 * 169.254.169.254 cloud metadata endpoint), CGNAT, reserved, or otherwise not
 * a public unicast destination.
 */
export function isBlockedIpv4(ip: string): boolean {
	const octets = parseIpv4(ip);
	if (!octets) {
		return true; // unparseable ⇒ refuse
	}
	const [a, b] = octets;
	if (a === 0) return true; // 0.0.0.0/8 "this host"
	if (a === 10) return true; // private
	if (a === 127) return true; // loopback
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
	if (a === 169 && b === 254) return true; // link-local incl. metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // private
	if (a === 192 && b === 168) return true; // private
	if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 reserved
	if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
	if (a === 198 && b === 51) return true; // 198.51.100/24 TEST-NET-2
	if (a === 203 && b === 0) return true; // 203.0.113/24 TEST-NET-3
	if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
	return false;
}

/**
 * Deny-by-default for IPv6: refuse everything that is not global unicast
 * (2000::/3). That single allowlist covers loopback, unspecified, unique-local
 * (fc00::/7), link-local (fe80::/10), and multicast (ff00::/8) in one rule; a
 * dotted IPv4-mapped form is classified by its embedded v4, and the compressed
 * hex mapped form (::ffff:7f00:1) fails the 2000::/3 test and is refused —
 * mapped-v4 in an AAAA record is never a legitimate public destination.
 */
export function isBlockedIpv6(ip: string): boolean {
	const addr = (ip.split("%")[0] ?? "").toLowerCase();
	if (addr === "::1" || addr === "::") {
		return true;
	}
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
	if (mapped?.[1]) {
		return isBlockedIpv4(mapped[1]);
	}
	const head = addr.split(":")[0] ?? "";
	// Global unicast 2000::/3 is the ONLY allowed range: first hex group leads
	// with 2 or 3. Everything else is refused.
	return !(head.startsWith("2") || head.startsWith("3"));
}

/** Strip the WHATWG brackets a URL keeps around an IPv6 host literal. */
function stripBrackets(host: string): string {
	return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Refuse any resolved address that is not a public unicast destination. */
export function isBlockedAddress(ip: string): boolean {
	const addr = stripBrackets(ip);
	const kind = isIP(addr);
	if (kind === 4) {
		return isBlockedIpv4(addr);
	}
	if (kind === 6) {
		return isBlockedIpv6(addr);
	}
	return true; // not an IP ⇒ refuse
}

/**
 * Validate the URL's SHAPE only (scheme + parseable). Cheap, synchronous,
 * suitable for config-save-time rejection. The real gate is the resolved-IP
 * check at delivery time — DNS can change after save.
 */
export const MAX_URL_LENGTH = 2048;

export function isDeliverableUrl(raw: string): boolean {
	if (raw.length > MAX_URL_LENGTH) {
		return false;
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") {
		return false;
	}
	// A literal-IP host is classified immediately; a name resolves at delivery.
	const host = stripBrackets(url.hostname);
	if (isIP(host) && isBlockedAddress(host)) {
		return false;
	}
	return true;
}

/**
 * Injected transport, for testing the fetch branches (redirect / timeout /
 * body cap) that the IP guard makes unreachable via localhost — the same
 * fetchImpl idiom the GitHub client uses. Production leaves these at their
 * real defaults.
 */
export interface GuardedFetchDeps {
	lookupImpl?: (host: string) => Promise<{ address: string }[]>;
	fetchImpl?: typeof fetch;
}

export interface GuardedPostOptions extends GuardedFetchDeps {
	/**
	 * A stable delivery id sent as both `X-Delivery-ID` and `Idempotency-Key`.
	 * MUST be constant across retries of the same logical delivery (the action
	 * row id) so the receiver can dedupe re-attempts — a fresh id per attempt
	 * defeats the entire purpose.
	 */
	deliveryId?: string;
	/**
	 * When set, the body is signed HMAC-SHA256 over `${timestamp}.${body}` and
	 * sent as `X-Webhook-Signature: t=<ts>,v1=<hex>`. The SAME serialized string
	 * is signed and sent (see guardedPost) — signing a different serialization
	 * than the wire body is the classic way HMAC webhooks ship broken.
	 */
	signingSecret?: string;
}

/**
 * POST a JSON body to a user-controlled URL through the full guard. Resolves
 * the host NOW and refuses if any resolved address is blocked (TOCTOU gate).
 * Never follows redirects, never reads more than MAX_BYTES, always discards
 * the body. The return names the failure class, never the URL.
 */
export async function guardedPost(
	raw: string,
	body: unknown,
	opts: GuardedPostOptions = {},
): Promise<GuardedFetchResult> {
	const lookupAll = opts.lookupImpl ?? ((host) => lookup(host, { all: true }));
	const doFetch = opts.fetchImpl ?? fetch;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, failure: "invalid-url" };
	}
	if (url.protocol !== "https:") {
		return { ok: false, failure: "not-https" };
	}

	// Resolve EVERY address the host maps to and refuse if any is blocked —
	// resolving only the first would let a multi-record host slip an internal
	// address past the guard.
	const host = stripBrackets(url.hostname);
	let addresses: string[];
	if (isIP(host)) {
		addresses = [host];
	} else {
		try {
			// DNS resolution gets its own budget — a host that hangs on lookup
			// must not stall the delivery job past the request timeout.
			const resolved = await Promise.race([
				lookupAll(host),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("dns-timeout")), DNS_TIMEOUT_MS),
				),
			]);
			addresses = resolved.map((entry) => entry.address);
		} catch {
			return { ok: false, failure: "unresolvable-host" };
		}
	}
	if (addresses.length === 0) {
		return { ok: false, failure: "unresolvable-host" };
	}
	if (addresses.some((address) => isBlockedAddress(address))) {
		return { ok: false, failure: "blocked-destination" };
	}

	// Serialize ONCE — this exact string is both signed and sent, so a valid
	// signature always matches the wire body.
	const bodyString = JSON.stringify(body);
	if (Buffer.byteLength(bodyString, "utf8") > MAX_REQUEST_BYTES) {
		return { ok: false, failure: "body-too-large" };
	}
	const timestamp = Date.now();
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (opts.deliveryId) {
		headers["x-webhook-timestamp"] = String(timestamp);
		headers["x-delivery-id"] = opts.deliveryId;
		headers["idempotency-key"] = opts.deliveryId;
	}
	if (opts.signingSecret) {
		const signature = createHmac("sha256", opts.signingSecret)
			.update(`${timestamp}.${bodyString}`)
			.digest("hex");
		headers["x-webhook-signature"] = `t=${timestamp},v1=${signature}`;
	}

	try {
		const response = await doFetch(url, {
			method: "POST",
			headers,
			body: bodyString,
			// LOAD-BEARING: `redirect: "manual"` returns a 3xx instead of following
			// it. Changing this to "follow" BREAKS the SSRF guard — a redirect to a
			// blocked host would connect AFTER the delivery-time IP check already
			// passed on the original host, bypassing it entirely. The 3xx-is-a-
			// failure handling below does not cover that; the setting does.
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		// A 3xx under manual redirect is an opaque/blocked response — treat any
		// redirect as a failure rather than following it into a private host.
		if (response.status >= 300 && response.status < 400) {
			return { ok: false, failure: "redirected", status: response.status };
		}
		// Drain a bounded slice and discard — we never reflect the body.
		await readCapped(response);
		if (!response.ok) {
			return { ok: false, failure: "http-error", status: response.status };
		}
		return { ok: true, status: response.status };
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			return { ok: false, failure: "timeout" };
		}
		return { ok: false, failure: "network-error" };
	}
}

/** Read at most MAX_BYTES from the body, then stop — the content is discarded. */
async function readCapped(response: Response): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		return;
	}
	let total = 0;
	while (total < MAX_BYTES) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
	}
	await reader.cancel().catch(() => undefined);
}
