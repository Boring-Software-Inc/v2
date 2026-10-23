import {
	type InstallState,
	signInstallState as sign,
	verifyInstallState as verify,
} from "@tripwire/auth/install-state";

function secret(): string {
	// In open-dev there's no auth and no install flow; a constant keeps the
	// helper total. Real installs run with BETTER_AUTH_SECRET set.
	return process.env.BETTER_AUTH_SECRET ?? "tripwire-open-dev-install-state";
}

export type { InstallState };

export function signInstallState(state: InstallState): string {
	return sign(state, secret());
}

export function verifyInstallState(
	state: string | undefined,
): InstallState | null {
	return verify(state, secret());
}
