import { createFileRoute, redirect } from "@tanstack/react-router";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

export const Route = createFileRoute("/account")({
	beforeLoad: async ({ context }) => {
		const session = await context.queryClient.ensureQueryData(
			sessionInfoQueryOptions(),
		);
		if (!session.defaultOrgSlug) {
			throw redirect({ to: "/" });
		}
		throw redirect({
			to: "/$org/settings/account",
			params: { org: session.defaultOrgSlug },
			replace: true,
		});
	},
});
