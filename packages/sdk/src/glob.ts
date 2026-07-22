/**
 * Glob-lite matcher: `*` spans within a segment, `**` spans segments.
 * Deterministic, no dependency. Moved verbatim from the honeypot rule; the
 * noneMatch comparison and the rule's evidence both call this one function.
 */
export function globMatch(pattern: string, path: string): boolean {
	const regex = new RegExp(
		`^${pattern
			.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
			.replaceAll("**", " ")
			.replaceAll("*", "[^/]*")
			.replaceAll(" ", ".*")}$`,
	);
	return regex.test(path);
}
