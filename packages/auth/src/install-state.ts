import { createHmac, timingSafeEqual } from "node:crypto";
import {
	type ForgeId,
	type InstallStatePayload,
	installStatePayloadSchema,
} from "@tripwire/contracts";

/** Signed hints suggest an org; claims still require explicit confirmation and fresh authority. Server-only. */

export interface InstallState {
	userId: string;
	orgId: string;
	forge?: "gitcafe";
	purpose?: "gitcafe-install";
	expiresAt?: number;
}

export function signInstallState(state: InstallState, secret: string): string {
	let hint: InstallStatePayload = { u: state.userId, o: state.orgId };
	if (state.forge === "gitcafe")
		hint = {
			...hint,
			f: "gitcafe",
			p: "gitcafe-install",
			e: state.expiresAt ?? Date.now() + 10 * 60_000,
		};
	const payload = Buffer.from(JSON.stringify(hint)).toString("base64url");
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
	const [payload, mac, extra] = state.split(".");
	if (!payload || !mac || extra) {
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
		const result = installStatePayloadSchema.safeParse(
			JSON.parse(Buffer.from(payload, "base64url").toString()),
		);
		if (!result.success) return null;
		const parsed = result.data;
		if (parsed.f === "gitcafe") {
			if (parsed.e <= Date.now()) return null;
			return {
				userId: parsed.u,
				orgId: parsed.o,
				forge: "gitcafe",
				purpose: "gitcafe-install",
				expiresAt: parsed.e,
			};
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
	forge: ForgeId,
	state: string,
	githubAppSlug: string | undefined,
	gitCafeAppSlug?: string,
): InstallUrlState {
	if (forge === "gitcafe") {
		return gitCafeAppSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gitCafeAppSlug)
			? {
					status: "ready",
					url: `https://git.cafe/apps/${gitCafeAppSlug}/install?state=${encodeURIComponent(state)}`,
				}
			: { status: "not-configured" };
	}
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
