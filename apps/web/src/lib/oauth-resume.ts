const SIGNATURE_KEYS = new Set(["sig", "exp"]);

export function oauthAuthorizeResume(
	search: Record<string, unknown>,
): string | null {
	if (
		typeof search.client_id !== "string" ||
		search.response_type !== "code" ||
		search.sig === undefined
	) {
		return null;
	}
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search)) {
		if (
			SIGNATURE_KEYS.has(key) ||
			key.startsWith("ba_") ||
			value === undefined ||
			value === null
		) {
			continue;
		}
		params.set(key, String(value));
	}
	return `/api/auth/oauth2/authorize?${params.toString()}`;
}
