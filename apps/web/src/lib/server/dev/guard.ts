/**
 * DEV-login security guard (§13) — the SECOND, runtime layer. The first layer
 * is compile-time: every caller lives behind `import.meta.env.DEV`, so this
 * code is absent from a production bundle. This layer refuses anything that
 * isn't a local request even in a dev build. Both throw loudly — never a
 * silent no-op — so a misconfiguration fails closed.
 */

/** Host header (may include a port) resolves to the loopback interface. */
export function isLoopbackHost(host: string | null | undefined): boolean {
	if (!host) {
		return false;
	}
	let h = host.trim().toLowerCase();
	if (h.startsWith("[")) {
		// [ipv6]:port — take what's inside the brackets.
		const end = h.indexOf("]");
		h = h.slice(1, end === -1 ? undefined : end);
	} else if (h.split(":").length <= 2) {
		// hostname or ipv4, with an optional :port.
		h = h.split(":")[0];
	}
	// else: a bare ipv6 (many colons, no brackets) — compare as-is.
	return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * Throw unless this is a dev build AND a loopback request. Pure and total so it
 * is unit-testable (production ⇒ throws; non-localhost ⇒ throws).
 */
export function assertDevLoginAllowed(input: {
	isDev: boolean;
	host: string | null | undefined;
}): void {
	if (!input.isDev) {
		throw new Error("dev login is disabled outside a dev build");
	}
	if (!isLoopbackHost(input.host)) {
		throw new Error(`dev login refused for non-local host: ${input.host}`);
	}
}
