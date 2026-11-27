/**
 * Paths a signed-in user who still has onboarding to do may open without being
 * sent to /onboarding: onboarding itself (with the GitHub setup callback),
 * invite redemption, and the agent consent and device screens.
 */
export function onboardingAllows(pathname: string): boolean {
	return (
		pathname === "/onboarding" ||
		pathname.startsWith("/onboarding/") ||
		pathname.startsWith("/invite/") ||
		pathname === "/consent" ||
		pathname === "/device"
	);
}
