/**
 * `TRIPWIRE_DISABLE_EXEMPTION` lets a repo owner test the gate against their own
 * (maintainer) PRs solo. It is a DEV affordance only: enabling it in production
 * would run rules against maintainers and could BLOCK them — a customer-facing
 * incident. So it is REFUSED under `NODE_ENV=production` (exemption stays on
 * regardless of the flag), the resolveAuthPosture pattern: fail toward the safe
 * posture. Pure over an env bag so it unit-tests without touching the process.
 */

export interface ExemptionEnv {
	TRIPWIRE_DISABLE_EXEMPTION?: string;
	NODE_ENV?: string;
}

/** True ⇒ maintainer/org-member exemption is OFF (every actor is evaluated). */
export function isExemptionDisabled(env: ExemptionEnv = process.env): boolean {
	if (env.TRIPWIRE_DISABLE_EXEMPTION !== "true") {
		return false;
	}
	return env.NODE_ENV !== "production";
}

/** True when the flag was set but ignored because we are in production. */
export function exemptionFlagRefusedInProd(
	env: ExemptionEnv = process.env,
): boolean {
	return (
		env.TRIPWIRE_DISABLE_EXEMPTION === "true" && env.NODE_ENV === "production"
	);
}
