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
