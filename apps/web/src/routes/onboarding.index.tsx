import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy pre-org URL — scope lives in the URL now (§8). Exact /onboarding
 * only: /onboarding/setup remains the GitHub App Setup callback.
 */
export const Route = createFileRoute("/onboarding/")({
	beforeLoad: () => {
		throw redirect({ to: "/" });
	},
});
