import { createHmac, timingSafeEqual } from "node:crypto";
import type { Forge } from "@tripwire/contracts";

/**
 * CSRF-safe install `state` (§10). The install URL carries a state that
 * HMAC-binds the initiating USER **and the target ORG** — the Setup URL
 * callback verifies both: the state's user must match the signed-in session,
 * and the installation is claimed for the state's org (after the confirmation
 * screen names both sides). An attacker can't forge a state (no secret), so
 * they can't trick a logged-in victim into claiming a foreign installation OR
 * into landing an installation in the wrong org. Installs arriving with no
 * valid state (initiated on GitHub's side) go to the claim screen instead —
 * never auto-attached. Server-only (Node crypto; never bundled client-side).
 */

export interface InstallState {
	userId: string;
	orgId: string;
}

export function signInstallState(state: InstallState, secret: string): string {
	const payload = Buffer.from(
		JSON.stringify({ u: state.userId, o: state.orgId }),
	).toString("base64url");
	const mac = createHmac("sha256", secret).update(payload).digest("base64url");
	return `${payload}.${mac}`;
}

/** The bound {userId, orgId}, or null when the state is missing/forged. */
export function verifyInstallState(
	state: string | undefined,
	secret: string,
): InstallState | null {
	if (!state) {
		return null;
	}
	const [payload, mac] = state.split(".");
	if (!payload || !mac) {
		return null;
	}
	const expected = createHmac("sha256", secret)
		.update(payload)
		.digest("base64url");
	const got = Buffer.from(mac);
	const want = Buffer.from(expected);
	if (got.length !== want.length || !timingSafeEqual(got, want)) {
		return null;
	}
	try {
		const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
			u?: string;
			o?: string;
		};
		if (!parsed.u || !parsed.o) {
			return null;
		}
		return { userId: parsed.u, orgId: parsed.o };
	} catch {
		return null;
	}
}

export type InstallUrlState =
	| { status: "ready"; url: string }
	| { status: "not-configured" }
	| { status: "no-session" };

export function installUrlFor(
	forge: Forge,
	state: string,
	githubAppSlug: string | undefined,
): InstallUrlState {
	if (forge === "github") {
		return githubAppSlug
			? {
					status: "ready",
					url: `https://github.com/apps/${githubAppSlug}/installations/new?state=${encodeURIComponent(state)}`,
				}
			: { status: "not-configured" };
	}
	return { status: "not-configured" };
}
