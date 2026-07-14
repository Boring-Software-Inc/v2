/**
 * `TRIPWIRE_FAIL_READS` forces named context reads to throw, so the §11 live
 * E2E harness can exercise the fail-closed floor (reads degrade → rules skip →
 * verdict flips to `needs_review`) on a REAL pull request. Like
 * `TRIPWIRE_DISABLE_EXEMPTION`, it is a DEV affordance only: a production worker
 * must never self-degrade on an env flag, so it is REFUSED under
 * `NODE_ENV=production` (fail toward the truthful posture — real reads).
 *
 * The value is a comma list of read names (`diff`, `commits`, `contributor`) or
 * the shorthand `all`. Pure over an env bag so it unit-tests without the process.
 */

export interface ReadsInjectionEnv {
	TRIPWIRE_FAIL_READS?: string;
	NODE_ENV?: string;
}

/** The context reads that degrade independently — the injectable surface. */
export const INJECTABLE_READS = ["diff", "commits", "contributor"] as const;

/** The set of read names to force-fail; empty in production or when unset. */
export function forcedReadFailures(
	env: ReadsInjectionEnv = process.env,
): ReadonlySet<string> {
	if (!env.TRIPWIRE_FAIL_READS || env.NODE_ENV === "production") {
		return new Set();
	}
	const raw = env.TRIPWIRE_FAIL_READS.trim();
	if (raw === "all") {
		return new Set(INJECTABLE_READS);
	}
	return new Set(
		raw
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean),
	);
}

/** True when the flag was set but ignored because we are in production. */
export function readsInjectionRefusedInProd(
	env: ReadsInjectionEnv = process.env,
): boolean {
	return Boolean(env.TRIPWIRE_FAIL_READS) && env.NODE_ENV === "production";
}
