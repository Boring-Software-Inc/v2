/**
 * Exponential backoff with full jitter: a random delay in
 * [0, min(cap, base * 2^attempt)]. `attempt` is zero-based.
 */
export function backoffWithJitter(
	attempt: number,
	{ baseMs = 250, capMs = 30_000 }: { baseMs?: number; capMs?: number } = {},
): number {
	const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
	return Math.random() * ceiling;
}

/** HTTP responses that can be transient at forge read-after-write boundaries. */
export function isRetryableForgeStatus(status: number | undefined): boolean {
	return (
		status !== undefined &&
		([404, 408, 409, 425, 429].includes(status) || status >= 500)
	);
}
