import { type ForgeId, forgeSignIn } from "@tripwire/contracts";
import { authClient } from "#/lib/auth-client";

/**
 * Thrown when a forge rejected our stored credentials and no refresh can save
 * it — the user has to re-authorize. Distinct from a generic failure because
 * the recovery is a button, not a retry.
 */
export class ForgeReauthRequiredError extends Error {
	readonly forge: ForgeId;
	constructor(forge: ForgeId, message: string) {
		super(message);
		this.name = "ForgeReauthRequiredError";
		this.forge = forge;
	}
}

/**
 * Re-run OAuth for a forge the user has ALREADY linked, to replace dead tokens.
 *
 * `linkSocial`, not `signIn.social`: signing in again is a no-op once a session
 * exists — /login just bounces you to "/" — so there was no way to re-authorize
 * a forge without logging out entirely, and logging out and back in with GitHub
 * never touches the GitLab tokens. better-auth's link callback updates the
 * existing account row's tokens in place when the provider account matches.
 *
 * Returns to the page you left from, so a reconnect from the connect dialog
 * lands back on it.
 */
export async function reconnectForge(forge: ForgeId): Promise<string | null> {
	markPendingConnect(forge);
	const callbackURL = `${window.location.pathname}${window.location.search}`;
	// Mirrors the sign-in dispatch: a first-class provider links through
	// `linkSocial`, a genericOAuth one through `oauth2.link`. Calling the wrong
	// one 404s the provider id, so the catalog decides here too.
	const { error } =
		forgeSignIn(forge) === "oauth2"
			? await authClient.oauth2.link({ providerId: forge, callbackURL })
			: await authClient.linkSocial({ provider: forge, callbackURL });
	return error?.message ?? (error ? `couldn't reach ${forge}` : null);
}

/**
 * `linkSocial` leaves the page, so the intent that triggered it has to survive
 * the round trip. A search param would be cleaner but `$org`'s `validateSearch`
 * strips anything it doesn't own, so this rides in sessionStorage instead —
 * scoped to the tab and read exactly once.
 */
const PENDING_CONNECT_KEY = "tripwire:pending-forge-connect";

export function markPendingConnect(forge: ForgeId): void {
	sessionStorage.setItem(PENDING_CONNECT_KEY, forge);
}

/** Reads AND clears — a reload must not re-trigger the import. */
export function takePendingConnect(): string | null {
	const value = sessionStorage.getItem(PENDING_CONNECT_KEY);
	sessionStorage.removeItem(PENDING_CONNECT_KEY);
	return value;
}
