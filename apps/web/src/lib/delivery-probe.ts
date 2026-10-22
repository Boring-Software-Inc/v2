import { type GuardFailure, guardedPost } from "@tripwire/utils";

/**
 * Test a delivery URL's CONNECTION — the network path, not payload acceptance.
 * It POSTs a ping through the SSRF guard (the same `guardedPost` the worker
 * delivers with) and reports reachability: the host resolved, was not blocked,
 * TLS completed, no redirect, and the endpoint RESPONDED. A non-2xx status
 * (e.g. a receiver rejecting a synthetic ping with 400/404) still means the
 * connection works — the real verdict payload may be accepted — so it is
 * reported reachable, with the status, not a hard failure. Only a genuine
 * network failure (blocked destination, dns, timeout, redirect, not-https)
 * fails the test.
 *
 * Server-side only; the url never returns to the client.
 */
export type ProbeResult =
	| { ok: true; status: number }
	| { ok: false; failure: GuardFailure };

export async function probeDelivery(url: string): Promise<ProbeResult> {
	const result = await guardedPost(url, { event: "tripwire.test", version: 1 });
	if (result.ok) {
		return { ok: true, status: result.status };
	}
	// Reached the endpoint, got a non-2xx — the connection is fine.
	if (result.failure === "http-error") {
		return { ok: true, status: result.status ?? 0 };
	}
	return { ok: false, failure: result.failure };
}
