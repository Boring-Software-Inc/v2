/**
 * Pattern scanning over a textMap signal. The scan is a TRANSFORM: it
 * derives a list of matches from text keyed by location. The comparison
 * over it (empty) is a plain boolean verb, so verdict and evidence come
 * from one evaluation via resolvedValue.
 *
 * Patterns are LIVE data supplied at evaluation time by trusted code, so
 * there is no untrusted-regex surface and no ReDoS risk today. IF custom
 * rules ever let users author their own patterns, that feature brings its
 * own gate: serialization ({ kind, source, flags }) plus a linear-time
 * engine (RE2) for the untrusted patterns. Deferred with the feature.
 */

export interface ScanPattern {
	/** What a match of this pattern is, e.g. "eth". Lands in the evidence. */
	readonly kind: string;
	readonly pattern: RegExp;
}

export interface ScanMatch {
	readonly kind: string;
	readonly value: string;
	readonly location: string;
}

/**
 * Scan order is deterministic: map insertion order, then pattern order,
 * then match order within the text. Evidence order depends on this.
 */
export function scanTextMap(
	textByLocation: Readonly<Record<string, string>>,
	patterns: readonly ScanPattern[],
): ScanMatch[] {
	const matches: ScanMatch[] = [];
	for (const [location, text] of Object.entries(textByLocation)) {
		for (const { kind, pattern } of patterns) {
			for (const match of text.matchAll(pattern)) {
				matches.push({ kind, value: match[0], location });
			}
		}
	}
	return matches;
}
