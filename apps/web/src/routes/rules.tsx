import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy pre-org URL — scope lives in the URL now (§8). The old path carried
 * no org/repo, so the honest target is "/" (→ your default org's home).
 */
export const Route = createFileRoute("/rules")({
	beforeLoad: () => {
		throw redirect({ to: "/" });
	},
});
