function hostOf(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	try {
		return new URL(value).host.toLowerCase();
	} catch {
		return null;
	}
}

export function isCrossSiteRequest(
	headers: Headers,
	trustedOrigins: readonly string[],
): boolean {
	const site = headers.get("sec-fetch-site");
	if (site !== null) {
		return site !== "same-origin";
	}
	const raw = headers.get("origin");
	if (raw === null) {
		return false;
	}
	const origin = hostOf(raw);
	if (origin === null) {
		return true;
	}
	const hosts = new Set(
		[
			headers.get("x-forwarded-host"),
			headers.get("host"),
			...trustedOrigins.map(hostOf),
		]
			.filter((host): host is string => Boolean(host))
			.map((host) => host.toLowerCase()),
	);
	return !hosts.has(origin);
}

export async function assertSameOrigin(): Promise<void> {
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const trusted = [process.env.BETTER_AUTH_URL].filter(
		(origin): origin is string => Boolean(origin),
	);
	if (isCrossSiteRequest(getStartContext().request.headers, trusted)) {
		throw new Error("This request came from another site, so it was refused.");
	}
}
