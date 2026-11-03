import { z } from "zod";

const SIGNATURE_KEYS = new Set(["sig", "exp"]);
const oauthResumeSearchSchema = z
	.record(z.string(), z.unknown())
	.refine(
		(search) =>
			z.string().safeParse(search.client_id).success &&
			search.response_type === "code" &&
			search.sig !== undefined,
	);

export function oauthAuthorizeResume<SearchInput>(
	search: SearchInput,
): string | null {
	const parsed = oauthResumeSearchSchema.safeParse(search);
	if (!parsed.success) {
		return null;
	}
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(parsed.data)) {
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
