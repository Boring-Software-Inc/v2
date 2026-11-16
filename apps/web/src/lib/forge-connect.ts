import { FORGE_BY_ID, type ForgeId } from "@tripwire/contracts";
import { authClient } from "#/lib/auth-client";

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
	const { error } = await authClient.linkSocial({
		provider: forge,
		callbackURL,
	});
	return (
		error?.message ??
		(error
			? `Tripwire couldn't reach ${FORGE_BY_ID[forge]?.label ?? forge}. Try again in a minute.`
			: null)
	);
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
